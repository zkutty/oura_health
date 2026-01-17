import { SpotifyService, SpotifyTrack, AudioFeatures } from './spotifyService';
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
    userPlaylists: { enabled: boolean; weight: number; excludeIds: string[] };
    recommendations: { enabled: boolean; weight: number };
    genrePlaylists: { enabled: boolean; weight: number };
  };
  schedule: {
    initialTime: string;
    retryIntervalMinutes: number;
    maxRetries: number;
    timeoutHours: number;
  };
}

export interface ScoredTrack {
  track: SpotifyTrack;
  score: number;
  audioFeatures: AudioFeatures;
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

      // Step 2: Collect tracks from all sources
      const allTracks = await this.collectSourceTracks();
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
      const selectedTracks = this.selectTopTracks(scoredTracks, this.config.playlistSize);
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
  private async collectSourceTracks(): Promise<SpotifyTrack[]> {
    if (!this.config) {
      return [];
    }

    const allTracks: SpotifyTrack[] = [];
    const trackIds = new Set<string>();

    // 1. Collect from saved/liked tracks
    if (this.config.sources.savedTracks.enabled) {
      try {
        console.log('Collecting saved tracks...');
        const savedTracks = await this.spotifyService.getUserSavedTracks(500, 0);
        savedTracks.forEach(track => {
          if (!trackIds.has(track.id)) {
            allTracks.push(track);
            trackIds.add(track.id);
          }
        });
        console.log(`Added ${savedTracks.length} saved tracks`);
      } catch (error: any) {
        console.error('Error fetching saved tracks:', error.message);
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

        for (const playlist of playlists) {
          if (!excludeIds.includes(playlist.id)) {
            try {
              const tracks = await this.spotifyService.getPlaylistTracks(playlist.id);
              tracks.forEach(track => {
                if (!trackIds.has(track.id)) {
                  allTracks.push(track);
                  trackIds.add(track.id);
                }
              });
            } catch (error: any) {
              console.error(`Error fetching tracks from playlist ${playlist.name}:`, error.message);
            }
          }
        }
        console.log(`Total tracks after playlists: ${allTracks.length}`);
      } catch (error: any) {
        console.error('Error fetching user playlists:', error.message);
      }
    }

    // 3. Get recommendations based on existing tracks
    if (this.config.sources.recommendations.enabled && allTracks.length > 0) {
      try {
        console.log('Getting recommendations...');
        const energyMapping = this.getEnergyMappingForLevel(this.currentEnergyLevel);
        const topTracks = allTracks
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, 5)
          .map(t => t.id);

        const recommendations = await this.spotifyService.getRecommendations({
          seedTracks: topTracks,
          seedGenres: energyMapping.genres.slice(0, 2),
          targetEnergy: energyMapping.audioFeatureTargets.energy.target,
          targetValence: energyMapping.audioFeatureTargets.valence.target,
          limit: 50,
        });

        recommendations.forEach(track => {
          if (!trackIds.has(track.id)) {
            allTracks.push(track);
            trackIds.add(track.id);
          }
        });
        console.log(`Added ${recommendations.length} recommended tracks`);
      } catch (error: any) {
        console.error('Error fetching recommendations:', error.message);
      }
    }

    // 4. Get tracks from genre-specific featured playlists
    if (this.config.sources.genrePlaylists.enabled) {
      try {
        console.log('Getting tracks from featured playlists...');
        const energyMapping = this.getEnergyMappingForLevel(this.currentEnergyLevel);

        // Get featured playlists (general)
        const featuredPlaylists = await this.spotifyService.getFeaturedPlaylists();

        for (const playlist of featuredPlaylists.slice(0, 3)) {
          try {
            const tracks = await this.spotifyService.getPlaylistTracks(playlist.id);
            tracks.slice(0, 10).forEach(track => {
              if (!trackIds.has(track.id)) {
                allTracks.push(track);
                trackIds.add(track.id);
              }
            });
          } catch (error: any) {
            console.error(`Error fetching tracks from featured playlist:`, error.message);
          }
        }

        console.log(`Total tracks after featured playlists: ${allTracks.length}`);
      } catch (error: any) {
        console.error('Error fetching featured playlists:', error.message);
      }
    }

    return allTracks;
  }

  /**
   * Score and filter tracks based on audio features
   */
  private async filterAndScoreTracks(tracks: SpotifyTrack[], energyLevel: EnergyLevel): Promise<ScoredTrack[]> {
    if (!this.config) {
      return [];
    }

    const energyMapping = this.getEnergyMappingForLevel(energyLevel);
    const targets = energyMapping.audioFeatureTargets;

    // Get audio features for all tracks (in batches of 100)
    console.log('Fetching audio features for tracks...');
    const trackIds = tracks.map(t => t.id);
    const audioFeatures = await this.spotifyService.getAudioFeatures(trackIds);

    // Create a map for quick lookup
    const featuresMap = new Map(audioFeatures.map(f => [f.id, f]));

    const scoredTracks: ScoredTrack[] = [];
    const weights = { energy: 0.35, valence: 0.30, tempo: 0.20, acousticness: 0.15 };

    for (const track of tracks) {
      const features = featuresMap.get(track.id);
      if (!features) continue;

      // Apply hard filters (min/max ranges)
      if (features.energy < targets.energy.min || features.energy > targets.energy.max) {
        continue;
      }
      if (features.valence < targets.valence.min || features.valence > targets.valence.max) {
        continue;
      }

      // Calculate composite score based on distance from target
      let score = 0;

      // Energy score (closer to target is better)
      const energyDistance = Math.abs(features.energy - targets.energy.target);
      score += (1 - energyDistance) * weights.energy;

      // Valence score
      const valenceDistance = Math.abs(features.valence - targets.valence.target);
      score += (1 - valenceDistance) * weights.valence;

      // Tempo score (normalized)
      const tempoNormalized = Math.min(1, Math.max(0,
        (features.tempo - targets.tempo.min) / (targets.tempo.max - targets.tempo.min)
      ));
      const tempoTarget = (targets.tempo.target - targets.tempo.min) /
                         (targets.tempo.max - targets.tempo.min);
      const tempoDistance = Math.abs(tempoNormalized - tempoTarget);
      score += (1 - tempoDistance) * weights.tempo;

      // Acousticness score
      const acousticnessDistance = Math.abs(features.acousticness - targets.acousticness.target);
      score += (1 - acousticnessDistance) * weights.acousticness;

      scoredTracks.push({ track, score, audioFeatures: features });
    }

    // Sort by score descending
    return scoredTracks.sort((a, b) => b.score - a.score);
  }

  /**
   * Select top tracks with diversity (prevent artist over-representation)
   */
  private selectTopTracks(scoredTracks: ScoredTrack[], targetCount: number): SpotifyTrack[] {
    const selected: SpotifyTrack[] = [];
    const artistCounts = new Map<string, number>();
    const maxPerArtist = Math.max(3, Math.ceil(targetCount / 10)); // At least 3, max 10% from same artist

    // First pass: select highest-scored tracks with diversity constraint
    for (const scoredTrack of scoredTracks) {
      if (selected.length >= targetCount) break;

      const artist = scoredTrack.track.artists[0];
      const currentCount = artistCounts.get(artist) || 0;

      if (currentCount < maxPerArtist) {
        selected.push(scoredTrack.track);
        artistCounts.set(artist, currentCount + 1);
      }
    }

    // Second pass: if we don't have enough tracks, add more without diversity constraint
    if (selected.length < targetCount) {
      for (const scoredTrack of scoredTracks) {
        if (selected.length >= targetCount) break;
        if (!selected.find(t => t.id === scoredTrack.track.id)) {
          selected.push(scoredTrack.track);
        }
      }
    }

    return selected;
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
