import axios, { AxiosInstance } from 'axios';
import { createOAuthTokenStore, OAuthTokenStore } from './oauthTokenStore';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  uri: string;
  duration_ms: number;
  popularity?: number;
  sourceTags?: string[];
  sourceWeight?: number;
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
  items?: {
    total: number;
    items: any[];
  };
  snapshot_id: string;
}

export class SpotifyApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

export class SpotifyService {
  private client: AxiosInstance;
  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;
  private userId: string | null = null;
  private refreshPromise?: Promise<void>;
  private tokenLoadPromise?: Promise<void>;
  private readonly tokenStore?: OAuthTokenStore;

  constructor(tokenStore: OAuthTokenStore | undefined = createOAuthTokenStore('SPOTIFY')) {
    this.accessToken = process.env.SPOTIFY_ACCESS_TOKEN || '';
    this.refreshToken = process.env.SPOTIFY_REFRESH_TOKEN || '';
    this.clientId = process.env.SPOTIFY_CLIENT_ID || '';
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
    this.tokenStore = tokenStore;

    this.client = axios.create({
      baseURL: 'https://api.spotify.com/v1',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use(async (config) => {
      await this.ensureTokensLoaded();
      config.headers.Authorization = `Bearer ${this.accessToken}`;
      return config;
    });

    // Add response interceptor to handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const requestConfig = error.config as (typeof error.config & { _spotifyRefreshRetried?: boolean });
        if (error.response?.status === 401 && this.refreshToken && !requestConfig?._spotifyRefreshRetried) {
          try {
            requestConfig._spotifyRefreshRetried = true;
            await this.refreshAccessTokenOnce();
            // Retry the original request
            requestConfig.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.client.request(requestConfig);
          } catch (refreshError) {
            throw refreshError;
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private ensureTokensLoaded(): Promise<void> {
    if (!this.tokenStore) return Promise.resolve();
    if (!this.tokenLoadPromise) {
      this.tokenLoadPromise = this.tokenStore.load().then((tokens) => {
        if (!tokens) return;
        this.accessToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
        this.client.defaults.headers.Authorization = `Bearer ${this.accessToken}`;
      }).catch((error: any) => {
        throw new Error(`Failed to load persisted Spotify OAuth tokens: ${error.message}`);
      });
    }
    return this.tokenLoadPromise;
  }

  private refreshAccessTokenOnce(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async refreshAccessToken(): Promise<void> {
    let response;
    try {
      const authString = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      response = await axios.post('https://accounts.spotify.com/api/token',
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

    } catch (error) {
      throw new Error('Failed to refresh Spotify access token');
    }

    this.accessToken = response.data.access_token;
    if (response.data.refresh_token) {
      this.refreshToken = response.data.refresh_token;
    }
    this.client.defaults.headers.Authorization = `Bearer ${this.accessToken}`;

    if (this.tokenStore) {
      try {
        await this.tokenStore.save({ accessToken: this.accessToken, refreshToken: this.refreshToken });
      } catch (error: any) {
        throw new Error(`Failed to persist refreshed Spotify OAuth tokens: ${error.message}`);
      }
    }
  }

  private apiError(message: string, error: any): SpotifyApiError {
    return new SpotifyApiError(message, error.response?.status);
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
      throw this.apiError('Failed to fetch Spotify user profile', error);
    }
  }

  async getUserSavedTracks(limit: number = 50, offset: number = 0): Promise<SpotifyTrack[]> {
    try {
      const requested = Math.max(0, limit);
      const tracks: SpotifyTrack[] = [];
      while (tracks.length < requested) {
        const pageLimit = Math.min(50, requested - tracks.length);
        const response = await this.client.get('/me/tracks', {
          params: { limit: pageLimit, offset: offset + tracks.length },
        });
        const page = response.data.items.map((item: any) => ({
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists.map((a: any) => a.name),
          uri: item.track.uri,
          duration_ms: item.track.duration_ms,
          popularity: item.track.popularity,
        }));
        tracks.push(...page);
        if (!response.data.next || page.length === 0) break;
      }
      return tracks;
    } catch (error: any) {
      console.error('Error fetching saved tracks:', error.message);
      throw this.apiError('Failed to fetch saved tracks from Spotify', error);
    }
  }

  async getUserPlaylists(): Promise<SpotifyPlaylist[]> {
    try {
      const playlists: SpotifyPlaylist[] = [];
      let offset = 0;
      let hasNext = true;
      while (hasNext && playlists.length < 500) {
        const response = await this.client.get('/me/playlists', {
          params: { limit: 50, offset },
        });
        const page = response.data.items.map((playlist: any) => ({
          id: playlist.id,
          name: playlist.name,
          description: playlist.description || '',
          items: playlist.items,
          snapshot_id: playlist.snapshot_id,
        }));
        playlists.push(...page);
        offset += response.data.items.length;
        hasNext = Boolean(response.data.next) && response.data.items.length > 0;
      }
      return playlists;
    } catch (error: any) {
      console.error('Error fetching user playlists:', error.message);
      throw this.apiError('Failed to fetch playlists from Spotify', error);
    }
  }

  async getPlaylistTracks(playlistId: string, maxTracks: number = 100): Promise<SpotifyTrack[]> {
    try {
      const tracks: SpotifyTrack[] = [];
      let offset = 0;
      let hasNext = true;
      while (hasNext && tracks.length < maxTracks) {
        const response = await this.client.get(`/playlists/${playlistId}/items`, {
          params: { limit: 50, offset },
        });
        const page = response.data.items
          .map((item: any) => item.item || item.track)
          .filter((track: any) => track?.type === 'track' || track?.uri?.startsWith('spotify:track:'))
          .map((track: any) => ({
            id: track.id,
            name: track.name,
            artists: track.artists.map((a: any) => a.name),
            uri: track.uri,
            duration_ms: track.duration_ms,
            popularity: track.popularity,
          }));
        tracks.push(...page.slice(0, maxTracks - tracks.length));
        offset += response.data.items.length;
        hasNext = Boolean(response.data.next) && response.data.items.length > 0;
      }
      return tracks.slice(0, maxTracks);
    } catch (error: any) {
      console.error('Error fetching playlist tracks:', error.message);
      throw this.apiError('Failed to fetch playlist tracks from Spotify', error);
    }
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    try {
      const response = await this.client.get(`/playlists/${playlistId}`);

      return {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description || '',
        items: response.data.items,
        snapshot_id: response.data.snapshot_id,
      };
    } catch (error: any) {
      console.error('Error fetching playlist:', error.message);
      throw new Error('Failed to fetch playlist from Spotify');
    }
  }

  async createPlaylist(name: string, description: string, isPublic: boolean = false): Promise<SpotifyPlaylist> {
    try {
      const response = await this.client.post('/me/playlists', {
        name,
        description,
        public: isPublic,
      });

      return {
        id: response.data.id,
        name: response.data.name,
        description: response.data.description || '',
        items: response.data.items,
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
      await this.client.put(`/playlists/${playlistId}/items`, {
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
      await this.client.post(`/playlists/${playlistId}/items`, {
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
          limit: Math.min(Math.max(1, limit), 10),
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
      throw this.apiError('Failed to search tracks on Spotify', error);
    }
  }

}
