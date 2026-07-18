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

  it('builds a bounded deterministic music brief', () => {
    const service = new PlaylistService({} as SpotifyService);
    service.loadConfig({
      ...(spotifyConfig as PlaylistConfig),
      sources: {
        ...(spotifyConfig.sources as PlaylistConfig['sources']),
        search: { enabled: true, weight: 0.25, maxQueries: 2, maxTracksPerQuery: 10, discoveryRatio: 0.3 },
      },
    });
    const brief = service.buildDailyMusicBrief('low');
    expect(brief.energyLevel).toBe('low');
    expect(brief.searchQueries).toEqual(['indie mellow', 'folk easy']);
  });

  it('keeps a 70/30 library-discovery mix and caps each artist at three tracks', async () => {
    const track = (id: string, artist: string): SpotifyTrack => ({
      id,
      name: `Energetic ${id}`,
      artists: [artist],
      uri: `spotify:track:${id}`,
      duration_ms: 180000,
    });
    const library = [
      ...Array.from({ length: 5 }, (_, index) => track(`repeat-${index}`, 'Repeat Artist')),
      ...Array.from({ length: 12 }, (_, index) => track(`library-${index}`, `Library Artist ${index}`)),
    ];
    const discoveries = Array.from({ length: 12 }, (_, index) => track(`discovery-${index}`, `Discovery Artist ${index}`));
    const spotify = {
      getUserSavedTracks: vi.fn().mockResolvedValue(library),
      getUserPlaylists: vi.fn().mockResolvedValue([]),
      searchTracks: vi.fn().mockResolvedValue(discoveries),
      replacePlaylistTracks: vi.fn().mockResolvedValue(undefined),
    } as unknown as SpotifyService;
    const service = new PlaylistService(spotify);
    service.loadConfig({
      ...(spotifyConfig as PlaylistConfig),
      playlistSize: 10,
      sources: {
        ...(spotifyConfig.sources as PlaylistConfig['sources']),
        userPlaylists: { ...spotifyConfig.sources.userPlaylists, enabled: false },
        search: { enabled: true, weight: 0.25, maxQueries: 1, maxTracksPerQuery: 10, discoveryRatio: 0.3 },
      },
    });

    await service.generateDailyPlaylist({
      date: '2026-07-18',
      readiness: { day: '2026-07-18', score: 86, temperature_deviation: 0 },
      sleep: { day: '2026-07-18', score: 86 } as any,
    });

    expect(spotify.searchTracks).toHaveBeenCalledTimes(1);
    const uris = (spotify.replacePlaylistTracks as any).mock.calls[0][1] as string[];
    expect(uris).toHaveLength(10);
    expect(uris.filter(uri => uri.includes('discovery-'))).toHaveLength(3);
    expect(uris.filter(uri => uri.includes('repeat-')).length).toBeLessThanOrEqual(3);
  });

  it('stops further discovery calls after a Spotify 429 and still uses the library', async () => {
    const spotify = {
      getUserSavedTracks: vi.fn().mockResolvedValue([{
        id: 'saved', name: 'Saved', artists: ['Artist'], uri: 'spotify:track:saved', duration_ms: 1,
      }]),
      getUserPlaylists: vi.fn().mockResolvedValue([]),
      searchTracks: vi.fn().mockRejectedValue(new SpotifyApiError('rate limited', 429)),
      replacePlaylistTracks: vi.fn().mockResolvedValue(undefined),
    } as unknown as SpotifyService;
    const service = new PlaylistService(spotify);
    service.loadConfig({ ...(spotifyConfig as PlaylistConfig), playlistSize: 1 });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await service.generateDailyPlaylist({
      date: '2026-07-18',
      readiness: { day: '2026-07-18', score: 70, temperature_deviation: 0 },
      sleep: { day: '2026-07-18', score: 70 } as any,
    });
    expect(result.success).toBe(true);
    expect(spotify.searchTracks).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('429'));
    warning.mockRestore();
  });
});
