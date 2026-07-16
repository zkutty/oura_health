import { 
  APIGatewayProxyEvent, 
  APIGatewayProxyResult, 
  Context,
  SQSEvent,
  ScheduledEvent 
} from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  PutItemCommand,
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
import { EnergyLevel } from '../services/playlistService';
import { OuraExportService } from '../services/ouraExportService';
import { GoogleDocsOuraPublisher } from '../services/googleDocsOuraPublisher';
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
    console.log(`Received queued Oura webhook event: ${message.event.event_type}/${message.event.data_type}.`);
  }
};

/**
 * Lambda handler for scheduled morning automation (7 AM)
 */
export const scheduledMorningAutomation = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
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
let playlistRetryCount = 0;
const MAX_PLAYLIST_RETRIES = 5;

async function attemptPlaylistGeneration() {
  initializeServices();

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
      playlistRetryCount++;
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

      // Reset retry counter on success
      playlistRetryCount = MAX_PLAYLIST_RETRIES;
    } else {
      console.log(`✗ Playlist generation failed: ${result.message}`);
      playlistRetryCount++;
    }
  } catch (error: any) {
    console.error('Error in playlist generation:', error.message);
    playlistRetryCount++;
    throw error;
  }
}

export const scheduledPlaylistGeneration = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  console.log('Running scheduled playlist generation (7:45 AM)...');
  playlistRetryCount = 0; // Reset retry counter
  await attemptPlaylistGeneration();
};

/**
 * Lambda handler for playlist retry attempts (8 AM - 1 PM)
 */
export const scheduledPlaylistRetry = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
  if (playlistRetryCount < MAX_PLAYLIST_RETRIES) {
    console.log(`Retry attempt ${playlistRetryCount + 1}/${MAX_PLAYLIST_RETRIES} for playlist generation...`);
    await attemptPlaylistGeneration();
  } else {
    console.log('Max playlist generation retries reached for today.');
  }
};

/**
 * Lambda handler for evening wind-down (9 PM)
 */
export const scheduledEveningWindDown = async (
  event: ScheduledEvent,
  context: Context
): Promise<void> => {
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
