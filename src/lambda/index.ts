import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult, 
  Context,
  SQSEvent,
  ScheduledEvent 
} from 'aws-lambda';
import { ChangeMessageVisibilityCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { skillBuilder } from '../handlers/alexaHandlers';
import { OuraService } from '../services/ouraService';
import { SmartHomeService } from '../services/smartHomeService';
import { SpotifyService } from '../services/spotifyService';
import { PlaylistService } from '../services/playlistService';
import { GoveeService } from '../services/goveeService';
import { AlexaRoutineService } from '../services/alexaRoutineService';
import { LightingService } from '../services/lightingService';
import { DataFreshnessChecker } from '../utils/dataFreshnessChecker';
import { getEasternDate, isEasternScheduleRange, isEasternScheduleTime } from '../utils/easternSchedule';
import { EnergyLevel } from '../services/playlistService';
import { OuraExportService } from '../services/ouraExportService';
import { GoogleDocsOuraPublisher } from '../services/googleDocsOuraPublisher';
import {
  DynamoDbPlaylistGenerationStateStore,
  PlaylistGenerationGuard,
} from '../services/playlistGenerationStateStore';
import {
  createOuraWebhookReplayKey,
  parseOuraWebhookEvent,
  QueuedOuraWebhookEvent,
  verifyOuraWebhookSignature,
} from '../services/ouraWebhookService';
import * as fs from 'fs';
import * as path from 'path';

// Initialize services (singleton pattern for Lambda)
let ouraService: OuraService | null = null;
let spotifyService: SpotifyService | null = null;
let playlistService: PlaylistService | null = null;
let goveeService: GoveeService | null = null;
let alexaRoutineService: AlexaRoutineService | null = null;
let lightingService: LightingService | null = null;
let smartHomeService: SmartHomeService | null = null;
let ouraExportService: OuraExportService | null = null;
let googleDocsOuraPublisher: GoogleDocsOuraPublisher | null = null;
const sqs = new SQSClient({});
const dynamoDb = new DynamoDBClient({});
let playlistGenerationGuard: PlaylistGenerationGuard | undefined;
const REQUIRED_EXPORT_SECTIONS = ['sleep', 'readiness'] as const;
const WEBHOOK_MAX_RETRIES = 5;
const RECONCILIATION_LOOKBACK_DAYS = 7;

interface OuraExportState {
  date: string;
  status: 'pending' | 'completed' | 'failed';
  missingSections: string[];
  lastEventType?: string;
  lastEventObjectId?: string;
  lastExportedAt?: string;
  lastError?: string;
}

const webhookResponse = (statusCode: number, body: string): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: body }),
});

function initializeServices() {
  if (ouraService) return; // Already initialized

  ouraService = new OuraService();
  ouraExportService = new OuraExportService();
  googleDocsOuraPublisher = new GoogleDocsOuraPublisher();
  spotifyService = new SpotifyService();
  playlistService = new PlaylistService(spotifyService);
  
  // Initialize lighting based on provider
  const lightingConfigPath = path.join(__dirname, '../config/lightingConfig.json');
  const lightingConfigData = fs.readFileSync(lightingConfigPath, 'utf-8');
  const lightingConfig = JSON.parse(lightingConfigData);

  if (lightingConfig.provider === 'alexa') {
    alexaRoutineService = new AlexaRoutineService();
    lightingService = new LightingService(undefined, alexaRoutineService);
  } else {
    goveeService = new GoveeService();
    lightingService = new LightingService(goveeService);
  }

  lightingService.loadConfig(lightingConfig);
  lightingService.initialize().catch(err => {
    console.error('Failed to initialize lighting service:', err);
  });

  smartHomeService = new SmartHomeService(lightingService);

  // Load smart home configuration
  try {
    const configPath = path.join(__dirname, '../config/smartHomeConfig.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);
    smartHomeService.loadConfig(config);
  } catch (error) {
    console.error('Failed to load smart home configuration:', error);
  }

  // Load Spotify configuration
  try {
    const spotifyConfigPath = path.join(__dirname, '../config/spotifyConfig.json');
    const spotifyConfigData = fs.readFileSync(spotifyConfigPath, 'utf-8');
    const spotifyConfig = JSON.parse(spotifyConfigData);
    playlistService.loadConfig(spotifyConfig);
  } catch (error) {
    console.error('Failed to load Spotify configuration:', error);
  }
}

function getPlaylistGenerationGuard(): PlaylistGenerationGuard {
  if (!playlistGenerationGuard) {
    const tableName = process.env.PLAYLIST_GENERATION_STATE_TABLE;
    if (!tableName) throw new Error('PLAYLIST_GENERATION_STATE_TABLE is not configured');
    playlistGenerationGuard = new PlaylistGenerationGuard(
      new DynamoDbPlaylistGenerationStateStore(tableName, dynamoDb),
      5
    );
  }
  return playlistGenerationGuard;
}

/**
 * Lambda handler for Alexa Skill requests
 * Invokes the constructed custom skill directly.
 */
export const alexaHandler = async (event: unknown, context: Context) =>
  skillBuilder.invoke(event as any, context);

/** Handles Oura's endpoint-verification challenge. */
export const ouraWebhookVerification = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const token = event.queryStringParameters?.verification_token;
  const challenge = event.queryStringParameters?.challenge;
  if (!token || token !== process.env.OURA_WEBHOOK_VERIFICATION_TOKEN || !challenge) {
    console.warn('Rejected Oura webhook verification request.');
    return webhookResponse(401, 'Unauthorized');
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge }),
  };
};

/** Verifies Oura deliveries and queues them without fetching health data inline. */
export const ouraWebhookReceiver = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';
  const timestamp = event.headers['x-oura-timestamp'] || event.headers['X-Oura-Timestamp'];
  const signature = event.headers['x-oura-signature'] || event.headers['X-Oura-Signature'];

  if (!verifyOuraWebhookSignature(rawBody, timestamp, signature, process.env.OURA_CLIENT_SECRET || '')) {
    console.warn('Rejected Oura webhook delivery: invalid signature or timestamp.');
    return webhookResponse(401, 'Unauthorized');
  }

  const ouraEvent = parseOuraWebhookEvent(rawBody);
  if (!ouraEvent) {
    console.warn('Rejected Oura webhook delivery: malformed event.');
    return webhookResponse(400, 'Invalid payload');
  }

  const queueUrl = process.env.OURA_WEBHOOK_QUEUE_URL;
  const replayTable = process.env.OURA_WEBHOOK_REPLAY_TABLE;
  if (!queueUrl || !replayTable) {
    console.error('Oura webhook queue is not configured.');
    return webhookResponse(503, 'Unavailable');
  }

  const replayKey = createOuraWebhookReplayKey(rawBody, timestamp!);
  const now = Math.floor(Date.now() / 1000);
  try {
    await dynamoDb.send(new PutItemCommand({
      TableName: replayTable,
      Item: {
        eventId: { S: replayKey },
        expiresAt: { N: String(now + 600) },
      },
      ConditionExpression: 'attribute_not_exists(eventId) OR expiresAt < :now',
      ExpressionAttributeValues: { ':now': { N: String(now) } },
    }));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || (error as any)?.name === 'ConditionalCheckFailedException') {
      console.warn('Rejected Oura webhook delivery: replayed event.');
      return webhookResponse(409, 'Replay detected');
    }
    console.error('Unable to record Oura webhook event.');
    return webhookResponse(503, 'Unavailable');
  }

  const message: QueuedOuraWebhookEvent = { receivedAt: new Date().toISOString(), event: ouraEvent };
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
  console.log(`Queued Oura webhook event: ${ouraEvent.event_type}/${ouraEvent.data_type}.`);
  return webhookResponse(202, 'Accepted');
};

/** Placeholder consumer: ZK-206 turns queued events into idempotent daily exports. */
export const processOuraWebhook = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body) as QueuedOuraWebhookEvent;
    try {
      const date = await processOuraExportForEvent(message);
      console.log(`Processed Oura webhook event for ${date}: ${message.event.data_type}.`);
    } catch (error) {
      const attempts = Number(record.attributes?.ApproximateReceiveCount || '1');
      const delaySeconds = Math.min(60 * (2 ** Math.max(attempts - 1, 0)), 3600);
      if (record.receiptHandle && attempts < WEBHOOK_MAX_RETRIES) {
        await sqs.send(new ChangeMessageVisibilityCommand({
          QueueUrl: process.env.OURA_WEBHOOK_QUEUE_URL,
          ReceiptHandle: record.receiptHandle,
          VisibilityTimeout: delaySeconds,
        }));
      }
      console.error(`Oura webhook processing failed (attempt ${attempts}/${WEBHOOK_MAX_RETRIES}).`, error);
      throw error;
    }
  }
};

/** Rechecks recent Oura days so a missed webhook or delayed mobile sync self-heals. */
export const reconcileOuraExports = async (): Promise<void> => {
  initializeServices();
  const dates = recentCalendarDates(RECONCILIATION_LOOKBACK_DAYS);
  let completed = 0;
  let pending = 0;

  for (const date of dates) {
    const existing = await getOuraExportState(date);
    if (existing?.status === 'completed' && existing.missingSections.length === 0) {
      continue;
    }
    const result = await processOuraExportForDate(date, { source: 'reconciliation' });
    if (result.status === 'completed') completed++;
    else pending++;
  }

  console.log(`Oura reconciliation finished: ${completed} complete, ${pending} pending across ${dates.length} day(s).`);
};

async function processOuraExportForEvent(message: QueuedOuraWebhookEvent): Promise<string> {
  initializeServices();
  if (!ouraService) throw new Error('Oura service is not initialized.');

  const date = await ouraService.getDayForWebhookObject(message.event.data_type, message.event.object_id);
  await processOuraExportForDate(date, {
    source: 'webhook',
    eventType: message.event.data_type,
    eventObjectId: message.event.object_id,
  });
  return date;
}

async function processOuraExportForDate(
  date: string,
  context: { source: 'webhook' | 'reconciliation'; eventType?: string; eventObjectId?: string }
): Promise<OuraExportState> {
  initializeServices();
  if (!ouraService || !ouraExportService || !googleDocsOuraPublisher) {
    throw new Error('Oura export services are not initialized.');
  }

  const summary = await ouraService.getSummaryForDate(date);
  const record = ouraExportService.toDailyExport(summary);
  const missingRequiredSections = REQUIRED_EXPORT_SECTIONS.filter(section => record.derived.missing_sections.includes(section));

  if (missingRequiredSections.length > 0) {
    const state = await saveOuraExportState({
      date,
      status: 'pending',
      missingSections: record.derived.missing_sections,
      lastEventType: context.eventType,
      lastEventObjectId: context.eventObjectId,
    });
    console.log(`Oura export for ${date} remains pending: ${missingRequiredSections.join(', ')} missing.`);
    return state;
  }

  try {
    const published = await googleDocsOuraPublisher.publish(record);
    if (!published) throw new Error('Google Docs Oura publisher is not configured.');

    const state = await saveOuraExportState({
      date,
      status: 'completed',
      missingSections: record.derived.missing_sections,
      lastEventType: context.eventType,
      lastEventObjectId: context.eventObjectId,
      lastExportedAt: new Date().toISOString(),
    });
    console.log(`Published complete Oura export for ${date}${published.updated ? ' (updated)' : ''}.`);
    return state;
  } catch (error) {
    await saveOuraExportState({
      date,
      status: 'failed',
      missingSections: record.derived.missing_sections,
      lastEventType: context.eventType,
      lastEventObjectId: context.eventObjectId,
      lastError: error instanceof Error ? error.message : 'Unknown export failure',
    });
    throw error;
  }
}

async function saveOuraExportState(state: OuraExportState): Promise<OuraExportState> {
  const tableName = process.env.OURA_EXPORT_STATE_TABLE;
  if (!tableName) throw new Error('OURA_EXPORT_STATE_TABLE is not configured.');

  const updatedAt = new Date().toISOString();
  await dynamoDb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: { date: { S: state.date } },
    UpdateExpression: 'SET #status = :status, missingSections = :missingSections, updatedAt = :updatedAt, lastEventType = :lastEventType, lastEventObjectId = :lastEventObjectId, lastExportedAt = :lastExportedAt, lastError = :lastError',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': { S: state.status },
      ':missingSections': { SS: state.missingSections.length > 0 ? state.missingSections : ['none'] },
      ':updatedAt': { S: updatedAt },
      ':lastEventType': { S: state.lastEventType || '' },
      ':lastEventObjectId': { S: state.lastEventObjectId || '' },
      ':lastExportedAt': { S: state.lastExportedAt || '' },
      ':lastError': { S: state.lastError || '' },
    },
  }));

  return state;
}

async function getOuraExportState(date: string): Promise<OuraExportState | undefined> {
  const tableName = process.env.OURA_EXPORT_STATE_TABLE;
  if (!tableName) throw new Error('OURA_EXPORT_STATE_TABLE is not configured.');

  const result = await dynamoDb.send(new GetItemCommand({
    TableName: tableName,
    Key: { date: { S: date } },
    ConsistentRead: true,
  }));
  const item = result.Item;
  if (!item) return undefined;

  const missingSections = (item.missingSections?.SS || []).filter(section => section !== 'none');
  const status = item.status?.S;
  if (status !== 'pending' && status !== 'completed' && status !== 'failed') return undefined;
  return {
    date,
    status,
    missingSections,
    lastEventType: item.lastEventType?.S || undefined,
    lastEventObjectId: item.lastEventObjectId?.S || undefined,
    lastExportedAt: item.lastExportedAt?.S || undefined,
    lastError: item.lastError?.S || undefined,
  };
}

function recentCalendarDates(days: number): string[] {
  const dates: string[] = [];
  for (let offset = 1; offset <= days; offset++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    dates.push(date.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Lambda handler for scheduled morning automation (7 AM)
 */
export const scheduledMorningAutomation = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  if (!isEasternScheduleTime(event.time, { hour: 7, minute: 0 })) {
    console.log(`Skipping morning automation outside 7:00 AM America/New_York (${event.time}).`);
    return;
  }

  initializeServices();

  console.log('Running scheduled morning automation (7 AM)...');
  
  try {
    if (!ouraService || !smartHomeService || !lightingService) {
      throw new Error('Services not initialized');
    }

    const summary = await ouraService.getTodaySummary();

    // Execute smart home actions
    const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);

    if (executedActions.length > 0) {
      console.log(`Executed ${executedActions.length} smart home actions:`, executedActions);
    } else {
      console.log('No smart home actions were triggered based on current health scores.');
    }

    // Sync lighting to Oura scores (morning lighting automation)
    const lightingConfig = lightingService.getConfig();
    if (lightingConfig && lightingConfig.enabled && lightingConfig.automation.morningLighting.enabled) {
      const readinessScore = summary.readiness?.score ?? 0;
      const sleepScore = summary.sleep?.score ?? 0;
      const combinedScore = (readinessScore * 0.6) + (sleepScore * 0.4);

      let energyLevel: EnergyLevel = 'moderate';
      if (combinedScore >= 90) energyLevel = 'very_high';
      else if (combinedScore >= 85) energyLevel = 'high';
      else if (combinedScore >= 75) energyLevel = 'moderate';
      else if (combinedScore >= 70) energyLevel = 'low';
      else energyLevel = 'very_low';

      const lightingResult = await lightingService.applySceneForEnergyLevel(energyLevel);
      if (lightingResult.success) {
        console.log(`✓ Applied ${energyLevel} lighting scene (${lightingResult.devicesUpdated} device(s))`);
      }
    }
  } catch (error: any) {
    console.error('Error in scheduled morning automation:', error.message);
    throw error;
  }
};

/**
 * Lambda handler for scheduled playlist generation (7:45 AM with retries)
 */
const MAX_PLAYLIST_RETRIES = 5;

async function attemptPlaylistGeneration(date: string) {
  initializeServices();
  const generationGuard = getPlaylistGenerationGuard();

  if (!await generationGuard.shouldAttempt(date)) {
    console.log(`Skipping playlist generation for ${date}; it already succeeded or reached ${MAX_PLAYLIST_RETRIES} attempts.`);
    return;
  }
  await generationGuard.recordAttempt(date);

  if (!ouraService || !playlistService || !lightingService || !ouraExportService || !googleDocsOuraPublisher) {
    throw new Error('Services not initialized');
  }

  try {
    // Get Oura data
    const summary = await ouraService.getTodaySummary();

    // Check if data is fresh
    if (!DataFreshnessChecker.isDataFreshForPlaylist(summary)) {
      const status = DataFreshnessChecker.getDataFreshnessStatus(summary);
      console.log(`Oura data is not fresh yet: ${status}. Will retry.`);
      return;
    }

    try {
      const record = ouraExportService.toDailyExport(summary);
      const published = await googleDocsOuraPublisher.publish(record);
      if (published) console.log(`Published Oura data for ${record.date} to Google Docs.`);
    } catch (error: any) {
      console.error('Failed to publish Oura data to Google Docs:', error.message);
    }

    // Data is fresh, generate playlist
    console.log('Oura data is fresh. Generating playlist...');
    const result = await playlistService.generateDailyPlaylist(summary);

    if (result.success) {
      console.log(`✓ Successfully generated playlist: ${result.playlistName}`);
      console.log(`  Added ${result.tracksAdded} tracks based on ${result.energyLevel} energy level`);
      console.log(`  Oura scores - Readiness: ${result.ouraScores.readiness}, Sleep: ${result.ouraScores.sleep}`);

      // Optionally sync lighting to the music energy level
      const lightingConfig = lightingService.getConfig();
      if (lightingConfig && lightingConfig.enabled && lightingConfig.automation.syncToPlaylist.enabled) {
        try {
          const lightingResult = await lightingService.applySceneForEnergyLevel(result.energyLevel);
          if (lightingResult.success) {
            console.log(`✓ Synced lighting to ${result.energyLevel} energy level (${lightingResult.devicesUpdated} devices)`);
          }
        } catch (error: any) {
          console.error('Error syncing lighting to playlist:', error.message);
        }
      }

      await generationGuard.markGenerated(date);
    } else {
      console.log(`✗ Playlist generation failed: ${result.message}`);
    }
  } catch (error: any) {
    console.error('Error in playlist generation:', error.message);
    throw error;
  }
}

export const scheduledPlaylistGeneration = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  if (!isEasternScheduleTime(event.time, { hour: 7, minute: 45 })) {
    console.log(`Skipping playlist generation outside 7:45 AM America/New_York (${event.time}).`);
    return;
  }

  console.log('Running scheduled playlist generation (7:45 AM)...');
  await attemptPlaylistGeneration(getEasternDate(event.time));
};

/**
 * Lambda handler for playlist retry attempts (8 AM - 1 PM)
 */
export const scheduledPlaylistRetry = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  if (!isEasternScheduleRange(event.time, { startHour: 8, endHour: 13, minute: 0 })) {
    console.log(`Skipping playlist retry outside 8:00 AM-1:00 PM America/New_York (${event.time}).`);
    return;
  }

  const date = getEasternDate(event.time);
  const generationGuard = getPlaylistGenerationGuard();
  if (!await generationGuard.shouldAttempt(date)) {
    console.log(`Skipping playlist retry for ${date}; generation already succeeded or max attempts were reached.`);
    return;
  }
  console.log(`Running durable playlist retry for ${date}...`);
  await attemptPlaylistGeneration(date);
};

/**
 * Lambda handler for evening wind-down (9 PM)
 */
export const scheduledEveningWindDown = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  if (!isEasternScheduleTime(event.time, { hour: 21, minute: 0 })) {
    console.log(`Skipping evening wind-down outside 9:00 PM America/New_York (${event.time}).`);
    return;
  }

  initializeServices();

  console.log('Running scheduled evening wind-down (9 PM)...');
  
  try {
    if (!lightingService) {
      throw new Error('Lighting service not initialized');
    }

    const lightingConfig = lightingService.getConfig();
    if (lightingConfig && lightingConfig.enabled && lightingConfig.automation.eveningWindDown.enabled) {
      const sceneName = lightingConfig.automation.eveningWindDown.scene;
      const result = await lightingService.applyNamedScene(sceneName);
      
      if (result.success) {
        console.log(`✓ Applied evening wind-down scene "${sceneName}" (${result.devicesUpdated} device(s))`);
      } else {
        console.error(`✗ Failed to apply evening wind-down scene: ${result.error}`);
      }
    }
  } catch (error: any) {
    console.error('Error in scheduled evening wind-down:', error.message);
    throw error;
  }
};
