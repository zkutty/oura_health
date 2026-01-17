import axios, { AxiosInstance } from 'axios';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  uri: string;
  duration_ms: number;
  popularity: number;
}

export interface AudioFeatures {
  id: string;
  energy: number;        // 0.0 to 1.0
  valence: number;       // 0.0 to 1.0 (happiness)
  danceability: number;  // 0.0 to 1.0
  tempo: number;         // BPM
  acousticness: number;  // 0.0 to 1.0
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  tracks?: {
    total: number;
    items: any[];
  };
  snapshot_id: string;
}

export interface RecommendationParams {
  seedTracks?: string[];
  seedArtists?: string[];
  seedGenres?: string[];
  targetEnergy?: number;
  targetValence?: number;
  minEnergy?: number;
  maxEnergy?: number;
  limit?: number;
}

export class SpotifyService {
  private client: AxiosInstance;
  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private userId: string | null = null;

  constructor() {
    this.accessToken = process.env.SPOTIFY_ACCESS_TOKEN || '';
    this.refreshToken = process.env.SPOTIFY_REFRESH_TOKEN || '';
    this.clientId = process.env.SPOTIFY_CLIENT_ID || '';
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';

    this.client = axios.create({
      baseURL: 'https://api.spotify.com/v1',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor to handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            await this.refreshAccessToken();
            // Retry the original request
            error.config.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.client.request(error.config);
          } catch (refreshError) {
            throw refreshError;
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const authString = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }).toString(),
        {
          headers: {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      if (response.data.refresh_token) {
        this.refreshToken = response.data.refresh_token;
      }

      // Update the default authorization header
      this.client.defaults.headers.Authorization = `Bearer ${this.accessToken}`;
    } catch (error) {
      throw new Error('Failed to refresh Spotify access token');
    }
  }

  private async getUserId(): Promise<string> {
    if (this.userId) {
      return this.userId;
    }

    try {
      const response = await this.client.get('/me');
      this.userId = response.data.id;
      return this.userId as string;
    } catch (error: any) {
      console.error('Error fetching user profile:', error.message);
      throw new Error('Failed to fetch Spotify user profile');
    }
  }

  async getUserSavedTracks(limit: number = 50, offset: number = 0): Promise<SpotifyTrack[]> {
    try {
      const response = await this.client.get('/me/tracks', {
        params: { limit, offset },
      });

      return response.data.items.map((item: any) => ({
        id: item.track.id,
        name: item.track.name,
        artists: item.track.artists.map((a: any) => a.name),
        uri: item.track.uri,
        duration_ms: item.track.duration_ms,
        popularity: item.track.popularity,
      }));
    } catch (error: any) {
      console.error('Error fetching saved tracks:', error.message);
      throw new Error('Failed to fetch saved tracks from Spotify');
    }
  }

  async getUserPlaylists(): Promise<SpotifyPlaylist[]> {
    try {
      const response = await this.client.get('/me/playlists', {
        params: { limit: 50 },
      });

      return response.data.items.map((playlist: any) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || '',
        tracks: playlist.tracks,
        snapshot_id: playlist.snapshot_id,
      }));
    } catch (error: any) {
      console.error('Error fetching user playlists:', error.message);
      throw new Error('Failed to fetch playlists from Spotify');
    }
  }

  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    try {
      const response = await this.client.get(`/playlists/${playlistId}/tracks`, {
        params: { limit: 100 },
      });

      return response.data.items
        .filter((item: any) => item.track !== null)
        .map((item: any) => ({
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists.map((a: any) => a.name),
          uri: item.track.uri,
          duration_ms: item.track.duration_ms,
          popularity: item.track.popularity,
        }));
    } catch (error: any) {
      console.error('Error fetching playlist tracks:', error.message);
      throw new Error('Failed to fetch playlist tracks from Spotify');
    }
  }

  async getRecommendations(params: RecommendationParams): Promise<SpotifyTrack[]> {
    try {
      const queryParams: any = {
        limit: params.limit || 20,
      };

      if (params.seedTracks && params.seedTracks.length > 0) {
        queryParams.seed_tracks = params.seedTracks.slice(0, 5).join(',');
      }
      if (params.seedArtists && params.seedArtists.length > 0) {
        queryParams.seed_artists = params.seedArtists.slice(0, 5).join(',');
      }
      if (params.seedGenres && params.seedGenres.length > 0) {
        queryParams.seed_genres = params.seedGenres.slice(0, 5).join(',');
      }
      if (params.targetEnergy !== undefined) {
        queryParams.target_energy = params.targetEnergy;
      }
      if (params.targetValence !== undefined) {
        queryParams.target_valence = params.targetValence;
      }
      if (params.minEnergy !== undefined) {
        queryParams.min_energy = params.minEnergy;
      }
      if (params.maxEnergy !== undefined) {
        queryParams.max_energy = params.maxEnergy;
      }

      const response = await this.client.get('/recommendations', { params: queryParams });

      return response.data.tracks.map((track: any) => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map((a: any) => a.name),
        uri: track.uri,
        duration_ms: track.duration_ms,
        popularity: track.popularity,
      }));
    } catch (error: any) {
      console.error('Error fetching recommendations:', error.message);
      throw new Error('Failed to fetch recommendations from Spotify');
    }
  }

  async getAudioFeatures(trackIds: string[]): Promise<AudioFeatures[]> {
    try {
      if (trackIds.length === 0) {
        return [];
      }

      // Spotify API allows up to 100 tracks per request
      const chunks: string[][] = [];
      for (let i = 0; i < trackIds.length; i += 100) {
        chunks.push(trackIds.slice(i, i + 100));
      }

      const allFeatures: AudioFeatures[] = [];

      for (const chunk of chunks) {
        const response = await this.client.get('/audio-features', {
          params: { ids: chunk.join(',') },
        });

        const features = response.data.audio_features
          .filter((f: any) => f !== null)
          .map((f: any) => ({
            id: f.id,
            energy: f.energy,
            valence: f.valence,
            danceability: f.danceability,
            tempo: f.tempo,
            acousticness: f.acousticness,
          }));

        allFeatures.push(...features);
      }

      return allFeatures;
    } catch (error: any) {
      console.error('Error fetching audio features:', error.message);
      throw new Error('Failed to fetch audio features from Spotify');
    }
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    try {
      const response = await this.client.get(`/playlists/${playlistId}`);

      return {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description || '',
        tracks: response.data.tracks,
        snapshot_id: response.data.snapshot_id,
      };
    } catch (error: any) {
      console.error('Error fetching playlist:', error.message);
      throw new Error('Failed to fetch playlist from Spotify');
    }
  }

  async createPlaylist(name: string, description: string, isPublic: boolean = false): Promise<SpotifyPlaylist> {
    try {
      const userId = await this.getUserId();

      const response = await this.client.post(`/users/${userId}/playlists`, {
        name,
        description,
        public: isPublic,
      });

      return {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description || '',
        tracks: response.data.tracks,
        snapshot_id: response.data.snapshot_id,
      };
    } catch (error: any) {
      console.error('Error creating playlist:', error.message);
      throw new Error('Failed to create playlist on Spotify');
    }
  }

  async replacePlaylistTracks(playlistId: string, trackUris: string[]): Promise<void> {
    try {
      // Spotify allows up to 100 tracks per request
      const firstBatch = trackUris.slice(0, 100);

      // Replace the playlist with the first batch
      await this.client.put(`/playlists/${playlistId}/tracks`, {
        uris: firstBatch,
      });

      // Add remaining tracks if any
      if (trackUris.length > 100) {
        const remainingBatches: string[][] = [];
        for (let i = 100; i < trackUris.length; i += 100) {
          remainingBatches.push(trackUris.slice(i, i + 100));
        }

        for (const batch of remainingBatches) {
          await this.addTracksToPlaylist(playlistId, batch);
        }
      }
    } catch (error: any) {
      console.error('Error replacing playlist tracks:', error.message);
      throw new Error('Failed to replace playlist tracks on Spotify');
    }
  }

  async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void> {
    try {
      await this.client.post(`/playlists/${playlistId}/tracks`, {
        uris: trackUris,
      });
    } catch (error: any) {
      console.error('Error adding tracks to playlist:', error.message);
      throw new Error('Failed to add tracks to playlist on Spotify');
    }
  }

  async searchTracks(query: string, limit: number = 20): Promise<SpotifyTrack[]> {
    try {
      const response = await this.client.get('/search', {
        params: {
          q: query,
          type: 'track',
          limit,
        },
      });

      return response.data.tracks.items.map((track: any) => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map((a: any) => a.name),
        uri: track.uri,
        duration_ms: track.duration_ms,
        popularity: track.popularity,
      }));
    } catch (error: any) {
      console.error('Error searching tracks:', error.message);
      throw new Error('Failed to search tracks on Spotify');
    }
  }

  async getFeaturedPlaylists(genre?: string): Promise<SpotifyPlaylist[]> {
    try {
      const params: any = { limit: 10 };
      if (genre) {
        params.locale = genre;
      }

      const response = await this.client.get('/browse/featured-playlists', { params });

      return response.data.playlists.items.map((playlist: any) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || '',
        tracks: playlist.tracks,
        snapshot_id: playlist.snapshot_id,
      }));
    } catch (error: any) {
      console.error('Error fetching featured playlists:', error.message);
      return []; // Return empty array instead of throwing to gracefully handle this optional feature
    }
  }
}
