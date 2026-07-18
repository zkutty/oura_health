import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthTokenStore, OAuthTokens } from './oauthTokenStore';
import { OuraService } from './ouraService';
import { SpotifyService } from './spotifyService';

function memoryStore(initial?: OAuthTokens): OAuthTokenStore & { value?: OAuthTokens } {
  return {
    value: initial,
    async load() { return this.value; },
    async save(tokens) { this.value = tokens; },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('rotated OAuth token persistence', () => {
  it('reloads rotated Oura tokens in a fresh service instance', async () => {
    const store = memoryStore({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'new-access', refresh_token: 'new-refresh' },
    });
    const first = new OuraService(store);
    await (first as any).ensureTokensLoaded();
    await (first as any).refreshAccessToken();

    const coldStart = new OuraService(store);
    await (coldStart as any).ensureTokensLoaded();
    expect((coldStart as any).accessToken).toBe('new-access');
    expect((coldStart as any).refreshToken).toBe('new-refresh');
  });

  it('reloads rotated Spotify tokens in a fresh service instance', async () => {
    const store = memoryStore({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'new-access', refresh_token: 'new-refresh' },
    });
    const first = new SpotifyService(store);
    await (first as any).ensureTokensLoaded();
    await (first as any).refreshAccessToken();

    const coldStart = new SpotifyService(store);
    await (coldStart as any).ensureTokensLoaded();
    expect((coldStart as any).accessToken).toBe('new-access');
    expect((coldStart as any).refreshToken).toBe('new-refresh');
  });

  it('surfaces token persistence failures clearly', async () => {
    const store: OAuthTokenStore = {
      load: vi.fn().mockResolvedValue({ accessToken: 'old', refreshToken: 'old-refresh' }),
      save: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    };
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: 'new-access' } });
    const service = new SpotifyService(store);
    await (service as any).ensureTokensLoaded();

    await expect((service as any).refreshAccessToken()).rejects.toThrow(
      'Failed to persist refreshed Spotify OAuth tokens: storage unavailable'
    );
  });
});
