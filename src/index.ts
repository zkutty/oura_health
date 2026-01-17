import express from 'express';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { skillBuilder } from './handlers/alexaHandlers';
import { OuraService } from './services/ouraService';
import { SmartHomeService } from './services/smartHomeService';
import { SpotifyService } from './services/spotifyService';
import { PlaylistService } from './services/playlistService';
import { DataFreshnessChecker } from './utils/dataFreshnessChecker';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const ouraService = new OuraService();
const smartHomeService = new SmartHomeService();
const spotifyService = new SpotifyService();
const playlistService = new PlaylistService(spotifyService);

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

// Middleware
app.use(express.json());

// Alexa Skill endpoint
const adapter = new ExpressAdapter(skillBuilder, false, false);
app.post('/alexa', adapter.getRequestHandlers());

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

// Scheduled job to check health scores and trigger actions
// Runs every morning at 7 AM
cron.schedule('0 7 * * *', async () => {
  console.log('Running scheduled health check and smart home action evaluation...');
  try {
    const summary = await ouraService.getTodaySummary();
    const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);

    if (executedActions.length > 0) {
      console.log(`Executed ${executedActions.length} smart home actions:`, executedActions);
    } else {
      console.log('No smart home actions were triggered based on current health scores.');
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

    // Data is fresh, generate playlist
    console.log('Oura data is fresh. Generating playlist...');
    const result = await playlistService.generateDailyPlaylist(summary);

    if (result.success) {
      console.log(`✓ Successfully generated playlist: ${result.playlistName}`);
      console.log(`  Added ${result.tracksAdded} tracks based on ${result.energyLevel} energy level`);
      console.log(`  Oura scores - Readiness: ${result.ouraScores.readiness}, Sleep: ${result.ouraScores.sleep}`);

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
});
