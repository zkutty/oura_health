import { SpotifyApiError, SpotifyService, SpotifyTrack } from './spotifyService';
import { OuraDailySummary } from './ouraService';

export type EnergyLevel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';
export const WELLNESS_BANDS = [60, 65, 70, 75, 80, 85, 90, 95, 100] as const;
export type WellnessBand = typeof WELLNESS_BANDS[number];

export interface WellnessMapping {
  band: WellnessBand;
  energyLevel: EnergyLevel;
  name: string;
  audioFeatureTargets: {
    energy: { min: number; max: number; target: number };
    valence: { min: number; max: number; target: number };
    tempo: { min: number; max: number; target: number };
    acousticness: { min: number; max: number; target: number };
  };
  genres: string[];
  moodKeywords: string[];
}

export interface PlaylistConfig {
  enabled: boolean;
  targetPlaylistId: string;
  targetPlaylistName: string;
  playlistSize: number;
  wellnessMappings: WellnessMapping[];
  sources: {
    savedTracks: { enabled: boolean; weight: number };
    discoverWeeklyArchive?: {
      enabled: boolean;
      playlistId?: string;
      playlistName?: string;
      weight: number;
      maxTracks?: number;
      reservedRatio: number;
    };
    userPlaylists: {
      enabled: boolean;
      weight: number;
      excludeIds: string[];
      maxPlaylists?: number;
      maxTracksPerPlaylist?: number;
    };
    search?: {
      enabled: boolean;
      weight: number;
      maxQueries: number;
      maxTracksPerQuery: number;
      discoveryRatio: number;
    };
  };
  schedule: {
    initialTime: string;
    retryIntervalMinutes: number;
    maxRetries: number;
    timeoutHours: number;
  };
}

export interface DailyMusicBrief {
  energyLevel: EnergyLevel;
  wellnessBand: WellnessBand;
  title: string;
  description: string;
  searchQueries: string[];
}

export interface ScoredTrack {
  track: SpotifyTrack;
  score: number;
  selectionSignals: string[];
}

export interface PlaylistGenerationResult {
  success: boolean;
  playlistId: string;
  playlistName: string;
  tracksAdded: number;
  energyLevel: EnergyLevel;
  wellnessBand?: WellnessBand;
  ouraScores: {
    readiness?: number;
    sleep?: number;
    activity?: number;
  };
  message?: string;
  musicBrief?: DailyMusicBrief;
}

export class PlaylistService {
  private spotifyService: SpotifyService;
  private config: PlaylistConfig | null = null;
  private currentEnergyLevel: EnergyLevel = 'moderate';
  private currentWellnessBand: WellnessBand = 80;

  constructor(spotifyService: SpotifyService) {
    this.spotifyService = spotifyService;
  }

  loadConfig(config: PlaylistConfig): void {
    this.config = config;
  }

  getConfig(): PlaylistConfig | null {
    return this.config;
  }

  /**
   * Main method to generate daily playlist based on Oura data
   */
  async generateDailyPlaylist(ouraData: OuraDailySummary): Promise<PlaylistGenerationResult> {
    if (!this.config || !this.config.enabled) {
      return {
        success: false,
        playlistId: '',
        playlistName: '',
        tracksAdded: 0,
        energyLevel: 'moderate',
        ouraScores: {},
        message: 'Spotify integration is not enabled',
      };
    }

    if (!this.config.targetPlaylistId) {
      return {
        success: false,
        playlistId: '',
        playlistName: '',
        tracksAdded: 0,
        energyLevel: 'moderate',
        ouraScores: {},
        message: 'Target playlist ID is not configured',
      };
    }

    try {
      console.log('Starting playlist generation...');

      // Step 1: Resolve the fine-grained wellness band used for music, while
      // retaining the coarse energy level consumed by lighting integrations.
      this.currentWellnessBand = this.determineWellnessBand(ouraData);
      const wellnessMapping = this.getWellnessMapping(this.currentWellnessBand);
      this.currentEnergyLevel = wellnessMapping.energyLevel;
      console.log(`Wellness band determined: ${this.currentWellnessBand} (${this.currentEnergyLevel})`);
      const musicBrief = this.buildDailyMusicBrief(this.currentWellnessBand);
      console.log(JSON.stringify({ event: 'daily_music_brief_created', ...musicBrief }));

      // Step 2: Collect tracks from all sources
      const allTracks = await this.collectSourceTracks(musicBrief);
      console.log(`Collected ${allTracks.length} tracks from all sources`);

      if (allTracks.length === 0) {
        return {
          success: false,
          playlistId: this.config.targetPlaylistId,
          playlistName: this.config.targetPlaylistName,
          tracksAdded: 0,
          energyLevel: this.currentEnergyLevel,
          wellnessBand: this.currentWellnessBand,
          ouraScores: {
            readiness: ouraData.readiness?.score,
            sleep: ouraData.sleep?.score,
            activity: ouraData.activity?.score,
          },
          message: 'No tracks available to generate playlist',
        };
      }

      // Step 3: Score and filter tracks
      const scoredTracks = await this.filterAndScoreTracks(allTracks, this.currentWellnessBand);
      console.log(`Scored and filtered to ${scoredTracks.length} tracks`);

      if (scoredTracks.length === 0) {
        return {
          success: false,
          playlistId: this.config.targetPlaylistId,
          playlistName: this.config.targetPlaylistName,
          tracksAdded: 0,
          energyLevel: this.currentEnergyLevel,
          wellnessBand: this.currentWellnessBand,
          ouraScores: {
            readiness: ouraData.readiness?.score,
            sleep: ouraData.sleep?.score,
            activity: ouraData.activity?.score,
          },
          message: 'No tracks matched the energy level criteria',
        };
      }

      // Step 4: Select top tracks with diversity
      const selectedTracks = this.selectHybridTracks(scoredTracks, this.config.playlistSize);
      console.log(`Selected ${selectedTracks.length} tracks for playlist`);

      // Step 5: Update playlist on Spotify
      await this.updatePlaylist(selectedTracks);
      console.log('Playlist updated successfully on Spotify');

      return {
        success: true,
        playlistId: this.config.targetPlaylistId,
        playlistName: this.config.targetPlaylistName,
        tracksAdded: selectedTracks.length,
        energyLevel: this.currentEnergyLevel,
        wellnessBand: this.currentWellnessBand,
        ouraScores: {
          readiness: ouraData.readiness?.score,
          sleep: ouraData.sleep?.score,
          activity: ouraData.activity?.score,
        },
        message: `Successfully generated ${this.currentEnergyLevel} energy playlist`,
        musicBrief,
      };
    } catch (error: any) {
      console.error('Error generating playlist:', error.message);
      return {
        success: false,
        playlistId: this.config.targetPlaylistId,
        playlistName: this.config.targetPlaylistName,
        tracksAdded: 0,
        energyLevel: this.currentEnergyLevel,
        wellnessBand: this.currentWellnessBand,
        ouraScores: {
          readiness: ouraData.readiness?.score,
          sleep: ouraData.sleep?.score,
          activity: ouraData.activity?.score,
        },
        message: `Failed to generate playlist: ${error.message}`,
      };
    }
  }

  /**
   * Average available readiness and sleep scores, constrain the result to the
   * configured 60-100 range, then round down to a stable five-point band.
   */
  private determineWellnessBand(ouraData: OuraDailySummary): WellnessBand {
    if (!this.config) {
      return 80;
    }

    const scores = [ouraData.readiness?.score, ouraData.sleep?.score]
      .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
    if (scores.length === 0) {
      console.warn(JSON.stringify({ event: 'wellness_band_fallback', reason: 'missing_scores', wellnessBand: 80 }));
      return 80;
    }

    const combinedScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const clampedScore = Math.min(100, Math.max(60, combinedScore));
    const wellnessBand = (Math.floor(clampedScore / 5) * 5) as WellnessBand;
    console.log(JSON.stringify({
      event: 'wellness_band_resolved',
      readiness: ouraData.readiness?.score,
      sleep: ouraData.sleep?.score,
      combinedScore,
      wellnessBand,
    }));
    return wellnessBand;
  }

  /**
   * Collect tracks from all enabled sources
   */
  private async collectSourceTracks(musicBrief: DailyMusicBrief): Promise<SpotifyTrack[]> {
    if (!this.config) {
      return [];
    }

    const tracksById = new Map<string, SpotifyTrack>();
    const sourceCounts = new Map<string, number>();
    const addTrack = (track: SpotifyTrack, sourceTags: string[], sourceWeight: number) => {
      const source = sourceTags[0];
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
      const existing = tracksById.get(track.id);
      if (existing) {
        existing.sourceTags = [...new Set([...(existing.sourceTags || []), ...sourceTags])];
        existing.sourceWeight = Math.max(existing.sourceWeight || 0, sourceWeight);
        return;
      }
      tracksById.set(track.id, { ...track, sourceTags, sourceWeight });
    };

    // 1. Collect from saved/liked tracks
    if (this.config.sources.savedTracks.enabled) {
      try {
        console.log('Collecting saved tracks...');
        const savedTracks = await this.spotifyService.getUserSavedTracks(500, 0);
        savedTracks.forEach(track => addTrack(
          track,
          ['saved', 'liked', 'favorites'],
          this.config!.sources.savedTracks.weight
        ));
        console.log(`Added ${savedTracks.length} saved tracks`);
      } catch (error: any) {
        this.logSourceDegradation('saved_tracks', error);
      }
    }

    // 2. Prefer the user's Discover Weekly archive as its own source. Resolve
    // by ID when configured, or by exact playlist name for portable setups.
    const archive = this.config.sources.discoverWeeklyArchive;
    let userPlaylists: Awaited<ReturnType<SpotifyService['getUserPlaylists']>> | undefined;
    let archivePlaylistId: string | undefined;
    if (archive?.enabled) {
      try {
        archivePlaylistId = archive.playlistId?.trim() || undefined;
        if (!archivePlaylistId) {
          userPlaylists = await this.spotifyService.getUserPlaylists();
          const configuredName = (archive.playlistName || 'Discover Weekly Archive').trim().toLowerCase();
          archivePlaylistId = userPlaylists.find(playlist => playlist.name.trim().toLowerCase() === configuredName)?.id;
        }
        if (!archivePlaylistId) {
          throw new Error(`Playlist not found: ${archive.playlistName || 'Discover Weekly Archive'}`);
        }
        const archiveTracks = await this.spotifyService.getPlaylistTracks(
          archivePlaylistId,
          archive.maxTracks ?? 500
        );
        archiveTracks.forEach(track => addTrack(
          track,
          ['discover-weekly-archive', 'archive', 'discover-weekly'],
          archive.weight
        ));
        console.log(JSON.stringify({
          event: 'spotify_source_collected',
          source: 'discover_weekly_archive',
          playlistId: archivePlaylistId,
          tracks: archiveTracks.length,
        }));
      } catch (error: any) {
        this.logSourceDegradation('discover_weekly_archive', error);
      }
    }

    // 3. Collect from user playlists
    if (this.config.sources.userPlaylists.enabled) {
      try {
        console.log('Collecting tracks from user playlists...');
        const playlists = userPlaylists ?? await this.spotifyService.getUserPlaylists();
        const excludeIds = [
          ...this.config.sources.userPlaylists.excludeIds,
          this.config.targetPlaylistId, // Always exclude target playlist
          ...(archivePlaylistId ? [archivePlaylistId] : []),
        ];
        const mapping = this.getWellnessMapping(this.currentWellnessBand);
        const desiredTerms = [...mapping.genres, ...mapping.moodKeywords]
          .map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
        const maxPlaylists = this.config.sources.userPlaylists.maxPlaylists ?? 10;
        const maxTracksPerPlaylist = this.config.sources.userPlaylists.maxTracksPerPlaylist ?? 100;
        const sourcePlaylists = playlists
          .filter(playlist => !excludeIds.includes(playlist.id))
          .sort((left, right) => {
            const relevance = (playlist: typeof left) => {
              const metadata = `${playlist.name} ${playlist.description}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ');
              return desiredTerms.filter(term => metadata.includes(term)).length;
            };
            return relevance(right) - relevance(left) || left.name.localeCompare(right.name);
          })
          .slice(0, maxPlaylists);

        for (const playlist of sourcePlaylists) {
          try {
              const tracks = await this.spotifyService.getPlaylistTracks(playlist.id, maxTracksPerPlaylist);
              const playlistTags = `${playlist.name} ${playlist.description}`
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(Boolean);
              tracks.forEach(track => addTrack(
                track,
                ['playlist', ...playlistTags],
                this.config!.sources.userPlaylists.weight
              ));
          } catch (error: any) {
            this.logSourceDegradation(`playlist:${playlist.id}`, error);
          }
        }
        console.log(`Total tracks after playlists: ${tracksById.size}`);
      } catch (error: any) {
        this.logSourceDegradation('user_playlists', error);
      }
    }

    // 4. Add bounded discoveries from Spotify search. Search results stay local;
    // no Spotify or Oura data is sent to an AI service.
    if (this.config.sources.search?.enabled) {
      const search = this.config.sources.search;
      for (const query of musicBrief.searchQueries.slice(0, Math.max(0, search.maxQueries))) {
        try {
          const tracks = await this.spotifyService.searchTracks(query, search.maxTracksPerQuery);
          tracks.forEach(track => addTrack(track, ['discovery', ...query.split(/\s+/)], search.weight));
        } catch (error: any) {
          this.logSourceDegradation(`search:${query}`, error);
          if (error instanceof SpotifyApiError && error.status === 429) break;
        }
      }
    }

    console.log(JSON.stringify({ event: 'spotify_source_summary', counts: Object.fromEntries(sourceCounts) }));
    return [...tracksById.values()];
  }

  /**
   * Score tracks using endpoints still available to Spotify development-mode apps.
   * Playlist names/descriptions supply energy and mood hints; source weighting
   * and a deterministic ID tie-break provide stable fallbacks.
   */
  private async filterAndScoreTracks(tracks: SpotifyTrack[], wellnessBand: WellnessBand): Promise<ScoredTrack[]> {
    if (!this.config) {
      return [];
    }

    const wellnessMapping = this.getWellnessMapping(wellnessBand);
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const desiredKeywords = [...wellnessMapping.genres, ...wellnessMapping.moodKeywords]
      .map(normalize);

    return tracks.map(track => {
      const searchable = normalize([track.name, ...track.artists, ...(track.sourceTags || [])].join(' '));
      const selectionSignals = desiredKeywords.filter(keyword => searchable.includes(keyword));
      const metadataScore = Math.min(1, selectionSignals.length / 3);
      const sourceScore = Math.min(1, Math.max(0, track.sourceWeight ?? 0));
      const score = (metadataScore * 0.75) + (sourceScore * 0.25);
      return { track, score, selectionSignals };
    }).sort((left, right) => right.score - left.score || left.track.id.localeCompare(right.track.id));
  }

  private logSourceDegradation(source: string, error: any): void {
    const status = error instanceof SpotifyApiError ? error.status : error?.status;
    const event = status === 403 ? 'spotify_source_degraded' : 'spotify_source_failed';
    console.warn(JSON.stringify({ event, source, status, message: error?.message || 'Unknown Spotify error' }));
  }

  /**
   * Select top tracks with diversity (prevent artist over-representation)
   */
  private selectHybridTracks(scoredTracks: ScoredTrack[], targetCount: number): SpotifyTrack[] {
    const selected: SpotifyTrack[] = [];
    const artistCounts = new Map<string, number>();
    const maxPerArtist = 3;
    const discoveryRatio = Math.min(0.5, Math.max(0, this.config?.sources.search?.discoveryRatio ?? 0.3));
    const discoveryTarget = Math.round(targetCount * discoveryRatio);
    const archive = scoredTracks.filter(item => item.track.sourceTags?.includes('discover-weekly-archive'));
    const archiveRatio = Math.min(1 - discoveryRatio, Math.max(
      0,
      this.config?.sources.discoverWeeklyArchive?.enabled
        ? this.config.sources.discoverWeeklyArchive.reservedRatio
        : 0
    ));
    const archiveTarget = archive.length > 0 ? Math.round(targetCount * archiveRatio) : 0;
    const libraryTarget = targetCount - discoveryTarget - archiveTarget;
    const library = scoredTracks.filter(item =>
      !item.track.sourceTags?.includes('discovery')
      && !item.track.sourceTags?.includes('discover-weekly-archive')
    );
    const discovery = scoredTracks.filter(item => item.track.sourceTags?.includes('discovery'));

    const selectFrom = (pool: ScoredTrack[], limit: number) => {
      let added = 0;
      for (const item of pool) {
        if (added >= limit || selected.length >= targetCount) break;
        if (selected.some(track => track.id === item.track.id)) continue;
        const artists = item.track.artists.map(artist => artist.toLowerCase());
        if (artists.some(artist => (artistCounts.get(artist) || 0) >= maxPerArtist)) continue;
        selected.push(item.track);
        artists.forEach(artist => artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1));
        added++;
      }
    };

    selectFrom(archive, archiveTarget);
    selectFrom(library, libraryTarget);
    selectFrom(discovery, discoveryTarget);
    selectFrom(library, targetCount - selected.length);
    selectFrom(scoredTracks, targetCount - selected.length);

    console.log(JSON.stringify({
      event: 'spotify_selection_summary',
      targetCount,
      archiveTarget,
      archiveSelected: selected.filter(track => track.sourceTags?.includes('discover-weekly-archive')).length,
      discoveryTarget,
      selected: selected.length,
    }));
    return selected;
  }

  buildDailyMusicBrief(wellnessBand: WellnessBand): DailyMusicBrief {
    const mapping = this.getWellnessMapping(wellnessBand);
    const maxQueries = Math.max(0, this.config?.sources.search?.maxQueries ?? 4);
    const genres = mapping.genres.slice(0, 3);
    const moods = mapping.moodKeywords.slice(0, 3);
    const searchQueries = genres.map((genre, index) => `${genre} ${moods[index % moods.length]}`)
      .slice(0, maxQueries);
    return {
      energyLevel: mapping.energyLevel,
      wellnessBand,
      title: mapping.name,
      description: `${mapping.name}: ${moods.join(', ')} music with ${genres.join(', ')} influences.`,
      searchQueries,
    };
  }

  /**
   * Update Spotify playlist with selected tracks
   */
  private async updatePlaylist(tracks: SpotifyTrack[]): Promise<void> {
    if (!this.config) {
      throw new Error('Playlist configuration not loaded');
    }

    const trackUris = tracks.map(t => t.uri);
    await this.spotifyService.replacePlaylistTracks(this.config.targetPlaylistId, trackUris);
  }

  /**
   * Helper to get music metadata for a five-point wellness band.
   */
  private getWellnessMapping(band: WellnessBand): WellnessMapping {
    if (!this.config) {
      throw new Error('Playlist configuration not loaded');
    }

    const mapping = this.config.wellnessMappings.find(m => m.band === band);
    if (!mapping) {
      throw new Error(`Wellness mapping not found for band: ${band}`);
    }

    return mapping;
  }
}
