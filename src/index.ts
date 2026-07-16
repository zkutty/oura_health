import express from 'express';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { skillBuilder } from './handlers/alexaHandlers';
import { OuraService } from './services/ouraService';
import { SmartHomeService } from './services/smartHomeService';
import { SpotifyService } from './services/spotifyService';
import { PlaylistService } from './services/playlistService';
import { GoveeService } from './services/goveeService';
import { AlexaRoutineService } from './services/alexaRoutineService';
import { LightingService } from './services/lightingService';
import { GoogleSheetsService } from './services/googleSheetsService';
import { SheetsExportService, DEFAULT_SHEETS_CONFIG, SheetsExportConfig } from './services/sheetsExportService';
import { DataFreshnessChecker } from './utils/dataFreshnessChecker';
import { EnergyLevel } from './services/playlistService';
import { OuraExportService } from './services/ouraExportService';
import { GoogleDocsOuraPublisher } from './services/googleDocsOuraPublisher';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const ouraService = new OuraService();
const ouraExportService = new OuraExportService();
const googleDocsOuraPublisher = new GoogleDocsOuraPublisher();
const spotifyService = new SpotifyService();
const playlistService = new PlaylistService(spotifyService);

// Initialize lighting service based on provider configuration
let lightingService: LightingService;
let goveeService: GoveeService | null = null;
let alexaRoutineService: AlexaRoutineService | null = null;

// Load lighting config to determine provider
try {
  const lightingConfigPath = path.join(__dirname, 'config', 'lightingConfig.json');
  const lightingConfigData = fs.readFileSync(lightingConfigPath, 'utf-8');
  const lightingConfig = JSON.parse(lightingConfigData);

  if (lightingConfig.provider === 'alexa') {
    alexaRoutineService = new AlexaRoutineService();
    lightingService = new LightingService(undefined, alexaRoutineService);
  } else {
    goveeService = new GoveeService();
    lightingService = new LightingService(goveeService);
  }
} catch (error) {
  // Fallback to Govee if config can't be loaded
  console.warn('Could not load lighting config, defaulting to Govee');
  goveeService = new GoveeService();
  lightingService = new LightingService(goveeService);
}

const smartHomeService = new SmartHomeService(lightingService);

// Load smart home configuration
try {
  const configPath = path.join(__dirname, 'config', 'smartHomeConfig.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configData);
  smartHomeService.loadConfig(config);
  console.log('Smart home configuration loaded');
} catch (error) {
  console.error('Failed to load smart home configuration:', error);
}

// Load Spotify configuration
try {
  const spotifyConfigPath = path.join(__dirname, 'config', 'spotifyConfig.json');
  const spotifyConfigData = fs.readFileSync(spotifyConfigPath, 'utf-8');
  const spotifyConfig = JSON.parse(spotifyConfigData);
  playlistService.loadConfig(spotifyConfig);
  console.log('Spotify configuration loaded');
} catch (error) {
  console.error('Failed to load Spotify configuration:', error);
}

// Initialize Google Sheets export service (optional)
let sheetsExportService: SheetsExportService | null = null;
try {
  const sheetsConfigPath = path.join(__dirname, 'config', 'sheetsConfig.json');
  const sheetsConfigData = fs.readFileSync(sheetsConfigPath, 'utf-8');
  const sheetsConfig: SheetsExportConfig = {
    ...DEFAULT_SHEETS_CONFIG,
    ...JSON.parse(sheetsConfigData),
  };
  // Allow env override of spreadsheet id
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    sheetsConfig.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }
  if (sheetsConfig.enabled) {
    const googleSheets = new GoogleSheetsService();
    sheetsExportService = new SheetsExportService(ouraService, googleSheets, sheetsConfig);
    console.log('Sheets export service initialized');
  } else {
    console.log('Sheets export disabled in sheetsConfig.json');
  }
} catch (error: any) {
  console.warn('Sheets export not initialized:', error.message);
}

// Load Lighting configuration
try {
  const lightingConfigPath = path.join(__dirname, 'config', 'lightingConfig.json');
  const lightingConfigData = fs.readFileSync(lightingConfigPath, 'utf-8');
  const lightingConfig = JSON.parse(lightingConfigData);
  lightingService.loadConfig(lightingConfig);
  lightingService.initialize().then(() => {
    console.log('Lighting service initialized');
  }).catch((error) => {
    console.error('Failed to initialize lighting service:', error);
  });
  console.log('Lighting configuration loaded');
} catch (error) {
  console.error('Failed to load lighting configuration:', error);
}

// Alexa Skill endpoint - MUST come before express.json() middleware
const adapter = new ExpressAdapter(skillBuilder, false, false);
app.post('/alexa', adapter.getRequestHandlers());

// Middleware - Applied to all routes AFTER /alexa
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manual trigger endpoint for testing smart home actions
app.post('/trigger-smart-home', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);
    
    res.json({
      success: true,
      executedActions,
      summary: {
        date: summary.date,
        sleep: summary.sleep?.score,
        readiness: summary.readiness?.score,
        activity: summary.activity?.score,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Endpoint to get today's health summary
app.get('/health-summary', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Test endpoint to check what data is available (last 7 days)
app.get('/test-oura-data', async (req, res) => {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    console.log(`Testing Oura data from ${startStr} to ${endStr}`);

    const sleepData = await ouraService.getSleepData(startStr, endStr);
    const readinessData = await ouraService.getReadinessData(startStr, endStr);
    const activityData = await ouraService.getActivityData(startStr, endStr);

    res.json({
      dateRange: { start: startStr, end: endStr },
      sleepRecords: sleepData.length,
      readinessRecords: readinessData.length,
      activityRecords: activityData.length,
      latestSleep: sleepData[sleepData.length - 1],
      latestReadiness: readinessData[readinessData.length - 1],
      latestActivity: activityData[activityData.length - 1],
    });
  } catch (error: any) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Comprehensive Oura connection test - checks all endpoints and data flow
app.get('/test-oura-connections', async (req, res) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  type EndpointResult = {
    ok: boolean;
    records?: number;
    error?: string;
    latest?: unknown;
  };

  const results: Record<string, EndpointResult> = {};
  const tests: Array<{ name: string; fn: () => Promise<unknown[]> }> = [
    { name: 'sleep', fn: () => ouraService.getSleepData(startStr, endStr) },
    { name: 'readiness', fn: () => ouraService.getReadinessData(startStr, endStr) },
    { name: 'activity', fn: () => ouraService.getActivityData(startStr, endStr) },
    { name: 'resilience', fn: () => ouraService.getResilienceData(startStr, endStr) },
    { name: 'heartRate', fn: () => ouraService.getHeartRateData(startStr, endStr) },
    { name: 'workouts', fn: () => ouraService.getWorkoutData(startStr, endStr) },
    { name: 'sessions', fn: () => ouraService.getSessionData(startStr, endStr) },
  ];

  for (const { name, fn } of tests) {
    try {
      const data = await fn();
      const latest = Array.isArray(data) && data.length > 0 ? data[data.length - 1] : undefined;
      results[name] = { ok: true, records: data.length, latest };
    } catch (error: any) {
      results[name] = { ok: false, error: error.message };
    }
  }

  // Also test getTodaySummary and getSevenDayTrends (used by Alexa/scheduling)
  try {
    const summary = await ouraService.getTodaySummary();
    results.todaySummary = {
      ok: true,
      latest: {
        date: summary.date,
        hasSleep: !!summary.sleep,
        hasReadiness: !!summary.readiness,
        hasActivity: !!summary.activity,
        hasResilience: !!summary.resilience,
      },
    };
  } catch (error: any) {
    results.todaySummary = { ok: false, error: error.message };
  }

  try {
    const trends = await ouraService.getSevenDayTrends();
    results.sevenDayTrends = {
      ok: true,
      latest: {
        sleep: trends.sleep,
        readiness: trends.readiness,
        activity: trends.activity,
      },
    };
  } catch (error: any) {
    results.sevenDayTrends = { ok: false, error: error.message };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  const connectionOk = results.sleep?.ok || results.readiness?.ok || results.activity?.ok;

  res.json({
    success: connectionOk,
    message: connectionOk
      ? (allOk ? 'All Oura connections and data flows are working.' : 'Core Oura data is flowing; some endpoints had issues.')
      : 'Oura connection or auth failed for core endpoints.',
    dateRange: { start: startStr, end: endStr },
    endpoints: results,
    summary: {
      working: Object.entries(results).filter(([, r]) => r.ok).length,
      total: Object.keys(results).length,
    },
  });
});

// Endpoint to manage smart home actions
app.get('/smart-home/config', (req, res) => {
  res.json(smartHomeService.getConfig());
});

app.post('/smart-home/action', (req, res) => {
  try {
    const action = req.body;
    smartHomeService.addAction(action);
    res.json({ success: true, message: 'Action added' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/smart-home/action/:id', (req, res) => {
  try {
    smartHomeService.removeAction(req.params.id);
    res.json({ success: true, message: 'Action removed' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Spotify playlist endpoints
app.post('/generate-playlist', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    const result = await playlistService.generateDailyPlaylist(summary);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/spotify/config', (req, res) => {
  res.json(playlistService.getConfig());
});

app.post('/spotify/config', (req, res) => {
  try {
    playlistService.loadConfig(req.body);
    res.json({ success: true, message: 'Spotify configuration updated' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/spotify/playlist-status', async (req, res) => {
  try {
    const config = playlistService.getConfig();
    if (!config || !config.targetPlaylistId) {
      return res.status(400).json({ error: 'Spotify playlist not configured' });
    }

    const playlist = await spotifyService.getPlaylist(config.targetPlaylistId);
    res.json({
      name: playlist.name,
      trackCount: playlist.tracks?.total || 0,
      lastModified: playlist.snapshot_id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/spotify/data-freshness', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    const isFresh = DataFreshnessChecker.isDataFreshForPlaylist(summary);
    const status = DataFreshnessChecker.getDataFreshnessStatus(summary);

    res.json({
      isFresh,
      status,
      summary: {
        date: summary.date,
        sleep: summary.sleep?.score,
        readiness: summary.readiness?.score,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Lighting control endpoints
app.post('/lighting/scene/:sceneName', async (req, res) => {
  try {
    const { sceneName } = req.params;
    const result = await lightingService.applyNamedScene(sceneName);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/lighting/energy-level', async (req, res) => {
  try {
    const { energyLevel } = req.body as { energyLevel: EnergyLevel };
    const result = await lightingService.applySceneForEnergyLevel(energyLevel);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/lighting/sync-to-oura', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    const readinessScore = summary.readiness?.score ?? 0;
    const sleepScore = summary.sleep?.score ?? 0;

    // Determine energy level based on scores
    let energyLevel: EnergyLevel = 'moderate';
    const combinedScore = (readinessScore * 0.6) + (sleepScore * 0.4);

    if (combinedScore >= 90) energyLevel = 'very_high';
    else if (combinedScore >= 85) energyLevel = 'high';
    else if (combinedScore >= 75) energyLevel = 'moderate';
    else if (combinedScore >= 70) energyLevel = 'low';
    else energyLevel = 'very_low';

    const result = await lightingService.applySceneForEnergyLevel(energyLevel);
    res.json({
      ...result,
      ouraScores: { readiness: readinessScore, sleep: sleepScore, combined: combinedScore },
      energyLevel,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/lighting/off', async (req, res) => {
  try {
    const result = await lightingService.turnOffAll();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/lighting/on', async (req, res) => {
  try {
    const result = await lightingService.turnOnAll();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/lighting/scenes', (req, res) => {
  const scenes = lightingService.getAvailableScenes();
  res.json({ scenes });
});

app.get('/lighting/config', (req, res) => {
  res.json(lightingService.getConfig());
});

// Google Sheets export endpoints
app.post('/sheets/sync', async (req, res) => {
  if (!sheetsExportService) {
    return res.status(503).json({ success: false, error: 'Sheets export not configured' });
  }
  try {
    const days = req.body?.days ? Number(req.body.days) : undefined;
    const result = await sheetsExportService.syncRecent(days);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/sheets/sync-range', async (req, res) => {
  if (!sheetsExportService) {
    return res.status(503).json({ success: false, error: 'Sheets export not configured' });
  }
  try {
    const { start, end } = req.body ?? {};
    if (!start || !end) {
      return res.status(400).json({ success: false, error: 'start and end (YYYY-MM-DD) are required' });
    }
    const result = await sheetsExportService.syncRange(start, end);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/sheets/setup', async (req, res) => {
  if (!sheetsExportService) {
    return res.status(503).json({ success: false, error: 'Sheets export not configured' });
  }
  try {
    await sheetsExportService.ensureSpreadsheetSetup();
    res.json({ success: true, message: 'Spreadsheet tabs and headers ensured' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/sheets/config', (req, res) => {
  if (!sheetsExportService) {
    return res.status(503).json({ error: 'Sheets export not configured' });
  }
  res.json(sheetsExportService.getConfig());
});

// Scheduled job to check health scores and trigger actions + lighting
// Runs every morning at 7 AM
cron.schedule('0 7 * * *', async () => {
  console.log('Running scheduled health check, smart home, and lighting automation...');
  try {
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
        console.log(`✓ Applied ${energyLevel} lighting scene to ${lightingResult.devicesUpdated} device(s)`);
      }
    }
  } catch (error: any) {
    console.error('Error in scheduled health check:', error.message);
  }
});

// Spotify playlist generation with smart retry logic
let playlistRetryCount = 0;
const MAX_PLAYLIST_RETRIES = 5;

// Helper function to attempt playlist generation
async function attemptPlaylistGeneration() {
  try {
    // Get Oura data
    const summary = await ouraService.getTodaySummary();

    // Check if data is fresh
    if (!DataFreshnessChecker.isDataFreshForPlaylist(summary)) {
      const status = DataFreshnessChecker.getDataFreshnessStatus(summary);
      console.log(`Oura data is not fresh yet: ${status}. Will retry in 1 hour.`);
      playlistRetryCount++;
      return;
    }

    try {
      const record = ouraExportService.toDailyExport(summary);
      const exportResult = await ouraExportService.exportDailyRecord(record);
      console.log(`Exported Oura data for ${exportResult.date} to ${exportResult.jsonlPath}`);

      const googleDocsResult = await googleDocsOuraPublisher.publish(record);
      if (googleDocsResult) {
        console.log(`Published Oura data for ${record.date} to Google Docs.`);
      }
    } catch (error: any) {
      // The playlist workflow should remain available if the local sync target is down.
      console.error('Failed to export Oura data:', error.message);
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
  }
}

// Initial playlist generation attempt at 7:45 AM
cron.schedule('45 7 * * *', async () => {
  console.log('Running scheduled playlist generation (7:45 AM)...');
  playlistRetryCount = 0; // Reset retry counter
  await attemptPlaylistGeneration();
});

// Retry playlist generation every hour from 8 AM to 1 PM
cron.schedule('0 8-13 * * *', async () => {
  if (playlistRetryCount < MAX_PLAYLIST_RETRIES) {
    console.log(`Retry attempt ${playlistRetryCount + 1}/${MAX_PLAYLIST_RETRIES} for playlist generation...`);
    await attemptPlaylistGeneration();
  } else {
    console.log('Max playlist generation retries reached for today.');
  }
});

// Daily Oura → Google Sheets sync
if (sheetsExportService) {
  const cfg = sheetsExportService.getConfig();
  cron.schedule(cfg.schedule, async () => {
    if (!sheetsExportService) return;
    console.log(`[SheetsSync] Running daily sync (last ${cfg.dailySyncDays} day(s))...`);
    try {
      const result = await sheetsExportService.syncRecent();
      const totalsLine = Object.entries(result.totals)
        .map(([tab, t]) => `${tab}=+${t.appended}/~${t.updated}`)
        .join(', ');
      console.log(`[SheetsSync] ✓ Days: ${result.daysProcessed.join(', ') || 'none'} | ${totalsLine}`);
    } catch (error: any) {
      console.error('[SheetsSync] Failed:', error.message);
    }
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Oura Health Alexa Skill server running on port ${PORT}`);
  console.log(`Alexa endpoint: http://localhost:${PORT}/alexa`);
  console.log(`Smart home automation: ${smartHomeService.getConfig().enabled ? 'enabled' : 'disabled'}`);

  const spotifyConfig = playlistService.getConfig();
  if (spotifyConfig && spotifyConfig.enabled) {
    console.log(`Spotify playlist automation: enabled`);
    console.log(`  Target playlist: ${spotifyConfig.targetPlaylistName}`);
    console.log(`  Scheduled time: ${spotifyConfig.schedule.initialTime} (with ${spotifyConfig.schedule.maxRetries} retries)`);
  } else {
    console.log(`Spotify playlist automation: disabled`);
  }

  const lightingConfig = lightingService.getConfig();
  if (lightingConfig && lightingConfig.enabled) {
    console.log(`Lighting automation: enabled (${lightingConfig.provider})`);
    console.log(`  Morning lighting: ${lightingConfig.automation.morningLighting.enabled ? 'enabled' : 'disabled'}`);
    console.log(`  Music sync: ${lightingConfig.musicSync.enabled ? 'enabled' : 'disabled'}`);
    console.log(`  Evening wind down: ${lightingConfig.automation.eveningWindDown.enabled ? 'enabled' : 'disabled'}`);
  } else {
    console.log(`Lighting automation: disabled`);
  }

  if (sheetsExportService) {
    const cfg = sheetsExportService.getConfig();
    console.log(`Sheets export: enabled`);
    console.log(`  Spreadsheet: ${cfg.spreadsheetId || '(not configured — set GOOGLE_SHEETS_SPREADSHEET_ID)'}`);
    console.log(`  Schedule: ${cfg.schedule} (last ${cfg.dailySyncDays} day(s))`);
  } else {
    console.log(`Sheets export: disabled`);
  }
});
