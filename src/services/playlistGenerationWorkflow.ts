import { createHash } from 'crypto';
import { OuraDailySummary, OuraReadinessData, OuraService } from './ouraService';
import { PlaylistGenerationResult, PlaylistService } from './playlistService';
import { SpotifyService } from './spotifyService';

export type PlaylistGenerationStatus = 'processing' | 'generated' | 'failed';

export interface PlaylistGenerationState {
  date: string;
  status: PlaylistGenerationStatus;
  fingerprint: string;
  attempts: number;
  updatedAt: string;
  leaseExpiresAt?: string;
  spotifySnapshotId?: string;
  lastError?: string;
  ouraInput: OuraPlaylistInput;
}

export interface OuraPlaylistInput {
  date: string;
  sleep: { score: number; totalSleepDuration?: number; efficiency?: number; bedtimeEnd?: string };
  readiness: { score: number; temperatureDeviation?: number; contributors?: OuraReadinessData['contributors'] };
}

export interface PlaylistGenerationStateStore {
  claim(date: string, fingerprint: string, ouraInput: OuraPlaylistInput, force?: boolean): Promise<'claimed' | 'duplicate' | 'busy'>;
  complete(date: string, fingerprint: string, spotifySnapshotId?: string): Promise<void>;
  fail(date: string, fingerprint: string, error: string): Promise<void>;
  get(date: string): Promise<PlaylistGenerationState | undefined>;
}

export interface PlaylistTaskQueue {
  enqueue(date: string, force?: boolean): Promise<void>;
}

export interface PlaylistWorkflowResult {
  outcome: 'generated' | 'duplicate' | 'busy';
  date: string;
  fingerprint: string;
  generation?: PlaylistGenerationResult;
  spotifySnapshotId?: string;
}

export class PlaylistGenerationWorkflow {
  constructor(
    private readonly ouraService: OuraService,
    private readonly playlistService: PlaylistService,
    private readonly spotifyService: SpotifyService,
    private readonly stateStore: PlaylistGenerationStateStore
  ) {}

  async generate(date: string, force = false): Promise<PlaylistWorkflowResult> {
    const summary = await this.ouraService.getSummaryForDate(date);
    if (!summary.sleep || !summary.readiness) {
      throw new Error(`Oura data for ${date} is incomplete; sleep and readiness are required.`);
    }

    const ouraInput = createOuraPlaylistInput(summary);
    const fingerprint = createOuraPlaylistFingerprint(summary);
    const claim = await this.stateStore.claim(date, fingerprint, ouraInput, force);
    if (claim !== 'claimed') {
      console.log(JSON.stringify({ event: 'playlist_generation_skipped', date, fingerprint, reason: claim }));
      return { outcome: claim, date, fingerprint };
    }

    console.log(JSON.stringify({ event: 'playlist_generation_started', date, fingerprint, force }));
    try {
      const generation = await this.playlistService.generateDailyPlaylist(summary);
      if (!generation.success) throw new Error(generation.message || 'Playlist generation failed.');
      const playlist = await this.spotifyService.getPlaylist(generation.playlistId);
      await this.stateStore.complete(date, fingerprint, playlist.snapshot_id);
      console.log(JSON.stringify({
        event: 'playlist_generation_completed',
        date,
        fingerprint,
        tracksAdded: generation.tracksAdded,
        energyLevel: generation.energyLevel,
        wellnessBand: generation.wellnessBand,
        spotifySnapshotId: playlist.snapshot_id,
      }));
      return {
        outcome: 'generated',
        date,
        fingerprint,
        generation,
        spotifySnapshotId: playlist.snapshot_id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown playlist generation failure';
      await this.stateStore.fail(date, fingerprint, message);
      console.error(JSON.stringify({ event: 'playlist_generation_failed', date, fingerprint, message }));
      throw error;
    }
  }
}

export function createOuraPlaylistFingerprint(summary: OuraDailySummary): string {
  return createHash('sha256').update(JSON.stringify(createOuraPlaylistInput(summary))).digest('hex').slice(0, 24);
}

export function createOuraPlaylistInput(summary: OuraDailySummary): OuraPlaylistInput {
  if (!summary.sleep || !summary.readiness) {
    throw new Error('Sleep and readiness are required to create a playlist input snapshot.');
  }
  return {
    date: summary.date,
    sleep: {
      score: summary.sleep.score,
      totalSleepDuration: summary.sleep.total_sleep_duration,
      efficiency: summary.sleep.efficiency,
      bedtimeEnd: summary.sleep.bedtime_end,
    },
    readiness: {
      score: summary.readiness.score,
      temperatureDeviation: summary.readiness.temperature_deviation,
      contributors: summary.readiness.contributors,
    },
  };
}
