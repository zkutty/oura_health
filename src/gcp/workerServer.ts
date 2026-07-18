import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleDocsOuraPublisher } from '../services/googleDocsOuraPublisher';
import { OuraDailyExportWorkflow } from '../services/ouraDailyExportWorkflow';
import { OuraExportService } from '../services/ouraExportService';
import { OuraService } from '../services/ouraService';
import { PlaylistConfig, PlaylistService } from '../services/playlistService';
import { PlaylistGenerationWorkflow } from '../services/playlistGenerationWorkflow';
import { SpotifyService } from '../services/spotifyService';
import { QueuedOuraWebhookEvent } from '../services/ouraWebhookService';
import { getEasternDate } from '../utils/easternSchedule';
import {
  FirestoreOuraExportStateStore,
  FirestorePlaylistGenerationStateStore,
} from './firestoreOuraStore';
import { GcpPlaylistTaskQueue } from './playlistTaskQueue';

const app = express();
app.use(express.json({ limit: '256kb' }));

const ouraService = new OuraService();
const exportWorkflow = new OuraDailyExportWorkflow(
  ouraService,
  new OuraExportService(),
  new GoogleDocsOuraPublisher(),
  new FirestoreOuraExportStateStore()
);
const spotifyService = new SpotifyService();
const playlistService = new PlaylistService(spotifyService);
playlistService.loadConfig(loadSpotifyConfig());
const playlistWorkflow = new PlaylistGenerationWorkflow(
  ouraService,
  playlistService,
  spotifyService,
  new FirestorePlaylistGenerationStateStore()
);
const playlistQueue = new GcpPlaylistTaskQueue();

app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));

app.post('/tasks/process-oura-webhook', async (request, response) => {
  try {
    const message = request.body as Partial<QueuedOuraWebhookEvent>;
    if (!message.event || typeof message.event.object_id !== 'string' || typeof message.event.data_type !== 'string') {
      return response.status(400).json({ error: 'Invalid queued event.' });
    }
    const state = await exportWorkflow.processEvent(message.event);
    if (state.status === 'completed') await playlistQueue.enqueue(state.date);
    return response.status(200).json({ date: state.date, status: state.status });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oura_webhook_processing_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Processing failed.' });
  }
});

app.post('/tasks/reconcile', async (request, response) => {
  try {
    const requestedDays = Number(request.body?.days || 7);
    const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 30
      ? requestedDays
      : 7;
    const result = await exportWorkflow.reconcile(days);
    console.log(JSON.stringify({ event: 'oura_reconciliation_completed', ...result }));
    return response.status(result.failed > 0 ? 500 : 200).json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oura_reconciliation_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Reconciliation failed.' });
  }
});

app.post('/admin/reexport', async (request, response) => {
  const date = String(request.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return response.status(400).json({ error: 'Use ?date=YYYY-MM-DD.' });
  }
  try {
    const state = await exportWorkflow.processDate(date);
    if (state.status === 'completed') await playlistQueue.enqueue(state.date);
    return response.status(200).json({ date: state.date, status: state.status });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'oura_manual_reexport_failed',
      date,
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Re-export failed.' });
  }
});

app.post('/tasks/generate-playlist', async (request, response) => {
  const date = String(request.body?.date || '');
  if (!isDate(date)) return response.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  try {
    const result = await playlistWorkflow.generate(date, request.body?.force === true);
    return response.status(200).json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'playlist_task_failed',
      date,
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Playlist generation failed.' });
  }
});

app.post('/tasks/playlist-fallback', async (request, response) => {
  const date = String(request.body?.date || getEasternDate(new Date()));
  if (!isDate(date)) return response.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  try {
    await playlistQueue.enqueue(date);
    console.log(JSON.stringify({ event: 'playlist_fallback_queued', date }));
    return response.status(202).json({ date, status: 'queued' });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'playlist_fallback_failed',
      date,
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Could not queue playlist generation.' });
  }
});

app.post('/admin/regenerate-playlist', async (request, response) => {
  const date = String(request.query.date || '');
  if (!isDate(date)) return response.status(400).json({ error: 'Use ?date=YYYY-MM-DD.' });
  try {
    await playlistQueue.enqueue(date, true);
    return response.status(202).json({ date, status: 'queued', force: true });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'playlist_manual_replay_failed',
      date,
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
    return response.status(500).json({ error: 'Could not queue playlist generation.' });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(JSON.stringify({ event: 'worker_service_started', port })));

function loadSpotifyConfig(): PlaylistConfig {
  const configPath = path.join(__dirname, '../config/spotifyConfig.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as PlaylistConfig;
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
