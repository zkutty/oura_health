import { describe, expect, it, vi } from 'vitest';
import { OuraDailySummary, OuraService } from './ouraService';
import { PlaylistService } from './playlistService';
import {
  createOuraPlaylistFingerprint,
  PlaylistGenerationState,
  PlaylistGenerationStateStore,
  PlaylistGenerationWorkflow,
  OuraPlaylistInput,
} from './playlistGenerationWorkflow';
import { SpotifyService } from './spotifyService';

class MemoryStore implements PlaylistGenerationStateStore {
  state?: PlaylistGenerationState;

  async claim(date: string, fingerprint: string, ouraInput: OuraPlaylistInput, force = false) {
    if (this.state?.status === 'processing') return 'busy' as const;
    if (!force && this.state?.status === 'generated' && this.state.fingerprint === fingerprint) {
      return 'duplicate' as const;
    }
    this.state = {
      date,
      fingerprint,
      status: 'processing',
      attempts: (this.state?.attempts || 0) + 1,
      updatedAt: new Date().toISOString(),
      ouraInput,
    };
    return 'claimed' as const;
  }

  async complete(date: string, fingerprint: string, spotifySnapshotId?: string) {
    this.state = { ...this.state!, date, fingerprint, status: 'generated', spotifySnapshotId };
  }

  async fail(date: string, fingerprint: string, error: string) {
    this.state = { ...this.state!, date, fingerprint, status: 'failed', lastError: error };
  }

  async get() {
    return this.state;
  }
}

const summary = {
  date: '2026-07-18',
  sleep: { day: '2026-07-18', score: 80, total_sleep_duration: 24000 },
  readiness: { day: '2026-07-18', score: 82, temperature_deviation: 0 },
  activity: { day: '2026-07-18', score: 70 },
} as OuraDailySummary;

function createWorkflow(store = new MemoryStore()) {
  const oura = { getSummaryForDate: vi.fn().mockResolvedValue(summary) } as unknown as OuraService;
  const playlists = {
    generateDailyPlaylist: vi.fn().mockResolvedValue({
      success: true,
      playlistId: 'daily',
      playlistName: 'Daily Health Mix',
      tracksAdded: 30,
      energyLevel: 'moderate',
      ouraScores: { sleep: 80, readiness: 82 },
    }),
  } as unknown as PlaylistService;
  const spotify = {
    getPlaylist: vi.fn().mockResolvedValue({ id: 'daily', snapshot_id: 'snapshot-1' }),
  } as unknown as SpotifyService;
  return { workflow: new PlaylistGenerationWorkflow(oura, playlists, spotify, store), playlists, store };
}

describe('PlaylistGenerationWorkflow', () => {
  it('updates Spotify once for duplicate deliveries of the same Oura data', async () => {
    const { workflow, playlists } = createWorkflow();
    expect((await workflow.generate(summary.date)).outcome).toBe('generated');
    expect((await workflow.generate(summary.date)).outcome).toBe('duplicate');
    expect(playlists.generateDailyPlaylist).toHaveBeenCalledTimes(1);
  });

  it('allows a manual forced replay and records the Spotify snapshot', async () => {
    const { workflow, playlists, store } = createWorkflow();
    await workflow.generate(summary.date);
    expect((await workflow.generate(summary.date, true)).outcome).toBe('generated');
    expect(playlists.generateDailyPlaylist).toHaveBeenCalledTimes(2);
    expect(store.state).toMatchObject({ status: 'generated', attempts: 2, spotifySnapshotId: 'snapshot-1' });
  });

  it('rejects incomplete Oura data before claiming work', async () => {
    const { workflow, store } = createWorkflow();
    (workflow as any).ouraService.getSummaryForDate.mockResolvedValue({ date: summary.date, sleep: summary.sleep });
    await expect(workflow.generate(summary.date)).rejects.toThrow('sleep and readiness are required');
    expect(store.state).toBeUndefined();
  });

  it('does not regenerate when activity arrives after the energy inputs are unchanged', () => {
    const changedActivity = { ...summary, activity: { ...summary.activity!, score: 95 } };
    expect(createOuraPlaylistFingerprint(changedActivity)).toBe(createOuraPlaylistFingerprint(summary));
  });
});
