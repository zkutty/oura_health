import axios from 'axios';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import http from 'http';
import { spawn } from 'child_process';

dotenv.config();

const redirectUri = process.env.OURA_OAUTH_REDIRECT_URI || 'http://localhost:9876/callback';
const clientId = required('OURA_CLIENT_ID');
const clientSecret = required('OURA_CLIENT_SECRET');
const state = randomBytes(24).toString('hex');

async function main(): Promise<void> {
  const redirect = new URL(redirectUri);
  if (redirect.hostname !== 'localhost' || redirect.pathname !== '/callback') {
    throw new Error('OURA_OAUTH_REDIRECT_URI must use http://localhost:<port>/callback for local setup.');
  }

  const port = Number(redirect.port || '9876');
  const authorizationUrl = new URL('https://cloud.ouraring.com/oauth/authorize');
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', process.env.OURA_OAUTH_SCOPES || 'daily stress');
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
      if (providerError) throw new Error(`Oura authorization failed: ${providerError}`);
      const code = requestUrl.searchParams.get('code');
      if (!code) throw new Error('Oura did not return an authorization code.');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const tokenResponse = await axios.post('https://api.ouraring.com/oauth/token', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const accessToken = tokenResponse.data?.access_token;
      const refreshToken = tokenResponse.data?.refresh_token;
      if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
        throw new Error('Oura token response did not include both access and refresh tokens.');
      }

      await updateEnv({
        OURA_ACCESS_TOKEN: accessToken,
        OURA_REFRESH_TOKEN: refreshToken,
        OURA_OAUTH_REDIRECT_URI: redirectUri,
      });
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('Oura authorization complete. You can close this tab and return to the terminal.');
      console.log('Oura OAuth authorization complete. Access and refresh tokens were saved to .env.');
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
    console.log(`Waiting for Oura authorization at ${redirectUri}...`);
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
