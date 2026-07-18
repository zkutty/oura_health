import { SpotifyApiError, SpotifyService, SpotifyTrack } from './spotifyService';
import { OuraDailySummary } from './ouraService';

export type EnergyLevel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

export interface EnergyMapping {
  level: EnergyLevel;
  name: string;
  conditions: {
    readinessThreshold: number;
    sleepThreshold: number;
    combinedOperator: 'and' | 'or';
  };
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
  energyMappings: EnergyMapping[];
  sources: {
    savedTracks: { enabled: boolean; weight: number };
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

      // Step 1: Determine energy level
      this.currentEnergyLevel = this.determineEnergyLevel(ouraData);
      console.log(`Energy level determined: ${this.currentEnergyLevel}`);
      const musicBrief = this.buildDailyMusicBrief(this.currentEnergyLevel);
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
          ouraScores: {
            readiness: ouraData.readiness?.score,
            sleep: ouraData.sleep?.score,
            activity: ouraData.activity?.score,
          },
          message: 'No tracks available to generate playlist',
        };
      }

      // Step 3: Score and filter tracks
      const scoredTracks = await this.filterAndScoreTracks(allTracks, this.currentEnergyLevel);
      console.log(`Scored and filtered to ${scoredTracks.length} tracks`);

      if (scoredTracks.length === 0) {
        return {
          success: false,
          playlistId: this.config.targetPlaylistId,
          playlistName: this.config.targetPlaylistName,
          tracksAdded: 0,
          energyLevel: this.currentEnergyLevel,
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
   * Determine energy level based on Oura scores
   */
  private determineEnergyLevel(ouraData: OuraDailySummary): EnergyLevel {
    if (!this.config) {
      return 'moderate';
    }

    const readinessScore = ouraData.readiness?.score ?? 0;
    const sleepScore = ouraData.sleep?.score ?? 0;

    console.log(`Oura scores - Readiness: ${readinessScore}, Sleep: ${sleepScore}`);

    // Sort energy mappings from highest to lowest threshold
    const sortedMappings = [...this.config.energyMappings].sort((a, b) => {
      return b.conditions.readinessThreshold - a.conditions.readinessThreshold;
    });

    // Find the first matching energy level
    for (const mapping of sortedMappings) {
      const { readinessThreshold, sleepThreshold, combinedOperator } = mapping.conditions;

      if (combinedOperator === 'and') {
        if (readinessScore >= readinessThreshold && sleepScore >= sleepThreshold) {
          console.log(`Matched energy level: ${mapping.level} (AND condition)`);
          return mapping.level;
        }
      } else {
        // 'or' operator
        if (readinessScore >= readinessThreshold || sleepScore >= sleepThreshold) {
          console.log(`Matched energy level: ${mapping.level} (OR condition)`);
          return mapping.level;
        }
      }
    }

    // Default to lowest energy level if no match
    console.log('No match found, defaulting to very_low');
    return 'very_low';
  }

  /**
   * Collect tracks from all enabled sources
   */
  private async collectSourceTracks(musicBrief: DailyMusicBrief): Promise<SpotifyTrack[]> {
    if (!this.config) {
      return [];
    }

    const tracksById = new Map<string, SpotifyTrack>();
    const addTrack = (track: SpotifyTrack, sourceTags: string[], sourceWeight: number) => {
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

    // 2. Collect from user playlists
    if (this.config.sources.userPlaylists.enabled) {
      try {
        console.log('Collecting tracks from user playlists...');
        const playlists = await this.spotifyService.getUserPlaylists();
        const excludeIds = [
          ...this.config.sources.userPlaylists.excludeIds,
          this.config.targetPlaylistId, // Always exclude target playlist
        ];
        const mapping = this.getEnergyMappingForLevel(this.currentEnergyLevel);
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

    // 3. Add bounded discoveries from Spotify search. Search results stay local;
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

    return [...tracksById.values()];
  }

  /**
   * Score tracks using endpoints still available to Spotify development-mode apps.
   * Playlist names/descriptions supply energy and mood hints; source weighting
   * and a deterministic ID tie-break provide stable fallbacks.
   */
  private async filterAndScoreTracks(tracks: SpotifyTrack[], energyLevel: EnergyLevel): Promise<ScoredTrack[]> {
    if (!this.config) {
      return [];
    }

    const energyMapping = this.getEnergyMappingForLevel(energyLevel);
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const desiredKeywords = [...energyMapping.genres, ...energyMapping.moodKeywords]
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
    const libraryTarget = targetCount - discoveryTarget;
    const library = scoredTracks.filter(item => !item.track.sourceTags?.includes('discovery'));
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

    selectFrom(library, libraryTarget);
    selectFrom(discovery, discoveryTarget);
    selectFrom(scoredTracks, targetCount - selected.length);

    return selected;
  }

  buildDailyMusicBrief(energyLevel: EnergyLevel): DailyMusicBrief {
    const mapping = this.getEnergyMappingForLevel(energyLevel);
    const maxQueries = Math.max(0, this.config?.sources.search?.maxQueries ?? 4);
    const genres = mapping.genres.slice(0, 3);
    const moods = mapping.moodKeywords.slice(0, 3);
    const searchQueries = genres.map((genre, index) => `${genre} ${moods[index % moods.length]}`)
      .slice(0, maxQueries);
    return {
      energyLevel,
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
   * Helper to get energy mapping configuration for a specific level
   */
  private getEnergyMappingForLevel(level: EnergyLevel): EnergyMapping {
    if (!this.config) {
      throw new Error('Playlist configuration not loaded');
    }

    const mapping = this.config.energyMappings.find(m => m.level === level);
    if (!mapping) {
      throw new Error(`Energy mapping not found for level: ${level}`);
    }

    return mapping;
  }
}
