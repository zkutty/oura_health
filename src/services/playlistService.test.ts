import { describe, expect, it, vi } from 'vitest';
import spotifyConfig from '../config/spotifyConfig.json';
import { OuraDailySummary } from './ouraService';
import { PlaylistService, PlaylistConfig, WELLNESS_BANDS, WellnessBand } from './playlistService';
import { SpotifyService } from './spotifyService';
import { SpotifyApiError, SpotifyTrack } from './spotifyService';

function determineBand(readiness?: number, sleep?: number) {
  const service = new PlaylistService({} as SpotifyService);
  service.loadConfig(spotifyConfig as PlaylistConfig);
  const summary = {
    date: '2026-07-18',
    readiness: readiness === undefined ? undefined : { day: '2026-07-18', score: readiness, temperature_deviation: 0 },
    sleep: sleep === undefined ? undefined : { day: '2026-07-18', score: sleep },
  } as OuraDailySummary;
  return (service as unknown as { determineWellnessBand(value: OuraDailySummary): WellnessBand }).determineWellnessBand(summary);
}

describe('PlaylistService wellness mapping', () => {
  it('maps every exact five-point boundary from 60 through 100', () => {
    for (const band of WELLNESS_BANDS) {
      expect(determineBand(band, band)).toBe(band);
    }
  });

  it('clamps scores below 60 and above 100', () => {
    expect(determineBand(59, 59)).toBe(60);
    expect(determineBand(105, 105)).toBe(100);
  });

  it('averages mixed scores and rounds down to the nearest band', () => {
    expect(determineBand(60, 100)).toBe(80);
    expect(determineBand(84, 89)).toBe(85);
    expect(determineBand(89, 90)).toBe(85);
  });

  it('uses an available score or the documented neutral fallback', () => {
    expect(determineBand(85, undefined)).toBe(85);
    expect(determineBand(undefined, 74)).toBe(70);
    expect(determineBand(undefined, undefined)).toBe(80);
  });

  it('provides a distinct music brief for all nine bands', () => {
    const service = new PlaylistService({} as SpotifyService);
    service.loadConfig(spotifyConfig as PlaylistConfig);
    const briefs = WELLNESS_BANDS.map(band => service.buildDailyMusicBrief(band));
    expect(new Set(briefs.map(brief => brief.title))).toHaveLength(9);
    expect(briefs.map(brief => brief.wellnessBand)).toEqual(WELLNESS_BANDS);
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
    const brief = service.buildDailyMusicBrief(70);
    expect(brief.energyLevel).toBe('low');
    expect(brief.wellnessBand).toBe(70);
    expect(brief.searchQueries).toEqual(['indie mellow', 'folk easy']);
  });

  it('reserves the configured share for matching Discover Weekly archive tracks', async () => {
    const track = (id: string, prefix: string): SpotifyTrack => ({
      id,
      name: `Upbeat ${prefix} ${id}`,
      artists: [`${prefix} Artist ${id}`],
      uri: `spotify:track:${id}`,
      duration_ms: 180000,
    });
    const archiveTracks = Array.from({ length: 8 }, (_, index) => track(`archive-${index}`, 'Archive'));
    const savedTracks = Array.from({ length: 10 }, (_, index) => track(`saved-${index}`, 'Saved'));
    const discoveries = Array.from({ length: 5 }, (_, index) => track(`discovery-${index}`, 'Discovery'));
    const spotify = {
      getUserSavedTracks: vi.fn().mockResolvedValue(savedTracks),
      getUserPlaylists: vi.fn().mockResolvedValue([
        { id: 'archive', name: 'Discover Weekly Archive', description: '', snapshot_id: '1' },
      ]),
      getPlaylistTracks: vi.fn().mockResolvedValue(archiveTracks),
      searchTracks: vi.fn().mockResolvedValue(discoveries),
      replacePlaylistTracks: vi.fn().mockResolvedValue(undefined),
    } as unknown as SpotifyService;
    const service = new PlaylistService(spotify);
    service.loadConfig({
      ...(spotifyConfig as PlaylistConfig),
      playlistSize: 10,
      sources: {
        ...(spotifyConfig.sources as PlaylistConfig['sources']),
        discoverWeeklyArchive: {
          enabled: true,
          playlistName: 'Discover Weekly Archive',
          weight: 0.8,
          maxTracks: 100,
          reservedRatio: 0.4,
        },
        userPlaylists: { ...spotifyConfig.sources.userPlaylists, enabled: false },
        search: { enabled: true, weight: 0.25, maxQueries: 1, maxTracksPerQuery: 10, discoveryRatio: 0.3 },
      },
    });

    const result = await service.generateDailyPlaylist({
      date: '2026-07-18',
      readiness: { day: '2026-07-18', score: 85, temperature_deviation: 0 },
      sleep: { day: '2026-07-18', score: 85 } as any,
    });

    expect(result.success).toBe(true);
    expect(result.wellnessBand).toBe(85);
    expect(spotify.getPlaylistTracks).toHaveBeenCalledWith('archive', 100);
    const uris = (spotify.replacePlaylistTracks as any).mock.calls[0][1] as string[];
    expect(uris.filter(uri => uri.includes('archive-'))).toHaveLength(4);
  });

  it('deduplicates archive tracks against saved tracks and keeps archive priority signals', async () => {
    const duplicate: SpotifyTrack = {
      id: 'duplicate', name: 'Bright Duplicate', artists: ['Artist'], uri: 'spotify:track:duplicate', duration_ms: 1,
    };
    const spotify = {
      getUserSavedTracks: vi.fn().mockResolvedValue([duplicate]),
      getUserPlaylists: vi.fn().mockResolvedValue([]),
      getPlaylistTracks: vi.fn().mockResolvedValue([duplicate]),
    } as unknown as SpotifyService;
    const service = new PlaylistService(spotify);
    service.loadConfig({
      ...(spotifyConfig as PlaylistConfig),
      sources: {
        ...(spotifyConfig.sources as PlaylistConfig['sources']),
        discoverWeeklyArchive: {
          enabled: true, playlistId: 'archive', weight: 0.8, maxTracks: 100, reservedRatio: 0.4,
        },
        userPlaylists: { ...spotifyConfig.sources.userPlaylists, enabled: false },
        search: { ...spotifyConfig.sources.search, enabled: false },
      },
    });

    const tracks = await (service as any).collectSourceTracks(service.buildDailyMusicBrief(85)) as SpotifyTrack[];
    expect(tracks).toHaveLength(1);
    expect(tracks[0].sourceTags).toEqual(expect.arrayContaining(['saved', 'discover-weekly-archive']));
    expect(tracks[0].sourceWeight).toBe(0.8);
  });

  it('falls back to other sources when the Discover Weekly archive is unavailable', async () => {
    const spotify = {
      getUserSavedTracks: vi.fn().mockResolvedValue([{
        id: 'saved', name: 'Saved', artists: ['Artist'], uri: 'spotify:track:saved', duration_ms: 1,
      }]),
      getUserPlaylists: vi.fn().mockResolvedValue([]),
      getPlaylistTracks: vi.fn().mockRejectedValue(new SpotifyApiError('unavailable', 503)),
      replacePlaylistTracks: vi.fn().mockResolvedValue(undefined),
    } as unknown as SpotifyService;
    const service = new PlaylistService(spotify);
    service.loadConfig({
      ...(spotifyConfig as PlaylistConfig),
      playlistSize: 1,
      sources: {
        ...(spotifyConfig.sources as PlaylistConfig['sources']),
        discoverWeeklyArchive: {
          enabled: true, playlistId: 'archive', weight: 0.8, maxTracks: 100, reservedRatio: 0.4,
        },
        userPlaylists: { ...spotifyConfig.sources.userPlaylists, enabled: false },
        search: { ...spotifyConfig.sources.search, enabled: false },
      },
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await service.generateDailyPlaylist({
      date: '2026-07-18',
      readiness: { day: '2026-07-18', score: 80, temperature_deviation: 0 },
      sleep: { day: '2026-07-18', score: 80 } as any,
    });

    expect(result.success).toBe(true);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('discover_weekly_archive'));
    warning.mockRestore();
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
