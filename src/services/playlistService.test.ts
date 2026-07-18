import { describe, expect, it, vi } from 'vitest';
import spotifyConfig from '../config/spotifyConfig.json';
import { OuraDailySummary } from './ouraService';
import { PlaylistService, PlaylistConfig } from './playlistService';
import { SpotifyService } from './spotifyService';
import { SpotifyApiError, SpotifyTrack } from './spotifyService';

function determineEnergy(readiness: number, sleep: number) {
  const service = new PlaylistService({} as SpotifyService);
  service.loadConfig(spotifyConfig as PlaylistConfig);
  const summary = {
    date: '2026-07-18',
    readiness: { day: '2026-07-18', score: readiness, temperature_deviation: 0 },
    sleep: { day: '2026-07-18', score: sleep },
  } as OuraDailySummary;
  return (service as unknown as { determineEnergyLevel(value: OuraDailySummary): string }).determineEnergyLevel(summary);
}

describe('PlaylistService energy mapping', () => {
  it('enforces the very-high AND thresholds', () => {
    expect(determineEnergy(90, 90)).toBe('very_high');
    expect(determineEnergy(90, 89)).toBe('high');
  });

  it('accepts either high-energy OR threshold', () => {
    expect(determineEnergy(85, 60)).toBe('high');
    expect(determineEnergy(60, 85)).toBe('high');
  });

  it('falls back to very low below all thresholds', () => {
    expect(determineEnergy(20, 20)).toBe('very_low');
  });
});

describe('PlaylistService supported Spotify sources', () => {
  it('generates from user playlists when saved tracks return 403', async () => {
    const tracks: SpotifyTrack[] = Array.from({ length: 4 }, (_, index) => ({
      id: `track-${index}`,
      name: `Energetic Track ${index}`,
      artists: [`Artist ${index}`],
      uri: `spotify:track:${index}`,
      duration_ms: 180000,
      popularity: 60 + index,
    }));
    const spotify = {
      getUserSavedTracks: vi.fn().mockRejectedValue(new SpotifyApiError('forbidden', 403)),
      getUserPlaylists: vi.fn().mockResolvedValue([
        { id: 'workout', name: 'Energetic Workout', description: 'uplifting dance', snapshot_id: '1' },
      ]),
      getPlaylistTracks: vi.fn().mockResolvedValue(tracks),
      replacePlaylistTracks: vi.fn().mockResolvedValue(undefined),
    } as unknown as SpotifyService;
    const service = new PlaylistService(spotify);
    service.loadConfig({
      ...(spotifyConfig as PlaylistConfig),
      targetPlaylistId: 'daily',
      playlistSize: 3,
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await service.generateDailyPlaylist({
      date: '2026-07-18',
      readiness: { day: '2026-07-18', score: 86, temperature_deviation: 0 },
      sleep: { day: '2026-07-18', score: 86 } as any,
    });

    expect(result.success).toBe(true);
    expect(spotify.replacePlaylistTracks).toHaveBeenCalledWith('daily', expect.any(Array));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('spotify_source_degraded'));
    warning.mockRestore();
  });
});
