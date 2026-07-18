import axios from 'axios';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import http from 'http';

dotenv.config();

const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:9877/callback';
const clientId = required('SPOTIFY_CLIENT_ID');
const clientSecret = required('SPOTIFY_CLIENT_SECRET');
const state = randomBytes(24).toString('hex');
const defaultScopes = [
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
].join(' ');

async function main(): Promise<void> {
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.pathname !== '/callback') {
    throw new Error('SPOTIFY_REDIRECT_URI must use http://127.0.0.1:<port>/callback for local setup.');
  }

  const port = Number(redirect.port || '9877');
  const authorizationUrl = new URL('https://accounts.spotify.com/authorize');
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', process.env.SPOTIFY_OAUTH_SCOPES || defaultScopes);
  authorizationUrl.searchParams.set('state', state);

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', redirectUri);
    if (requestUrl.pathname !== '/callback') {
      response.writeHead(404).end('Not found');
      return;
    }

    try {
      if (requestUrl.searchParams.get('state') !== state) throw new Error('OAuth state did not match.');
      const providerError = requestUrl.searchParams.get('error');
      if (providerError) throw new Error(`Spotify authorization failed: ${providerError}`);
      const code = requestUrl.searchParams.get('code');
      if (!code) throw new Error('Spotify did not return an authorization code.');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        body.toString(),
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      const accessToken = tokenResponse.data?.access_token;
      const refreshToken = tokenResponse.data?.refresh_token;
      if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
        throw new Error('Spotify token response did not include both access and refresh tokens.');
      }

      await updateEnv({
        SPOTIFY_ACCESS_TOKEN: accessToken,
        SPOTIFY_REFRESH_TOKEN: refreshToken,
        SPOTIFY_REDIRECT_URI: redirectUri,
        SPOTIFY_ENABLED: 'true',
      });
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('Spotify authorization complete. You can close this tab and return to the terminal.');
      console.log('Spotify OAuth authorization complete. Access and refresh tokens were saved to .env.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OAuth failure';
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(message);
      console.error(message);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Waiting for Spotify authorization at ${redirectUri}...`);
    const child = spawn('open', [authorizationUrl.toString()], { detached: true, stdio: 'ignore' });
    child.unref();
  });
}

async function updateEnv(values: Record<string, string>): Promise<void> {
  const envPath = '.env';
  let contents = '';
  try {
    contents = await fs.readFile(envPath, 'utf8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }

  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    contents = pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.replace(/\s*$/, '')}\n${line}\n`;
  }
  await fs.writeFile(envPath, contents, { encoding: 'utf8', mode: 0o600 });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in .env before starting OAuth.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
