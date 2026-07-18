# Setup Guide

Complete guide to setting up the Oura Health integration system with Spotify and smart lighting.

## Quick Start (5 Minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Get Oura API Credentials
- Visit https://cloud.ouraring.com/personal-access-tokens
- Generate a personal access token
- Copy the token (you'll need it in the next step)

### 3. Configure Environment Variables
```bash
cp .env.example .env
```

Edit `.env` and add your Oura token:
```env
OURA_ACCESS_TOKEN=your_token_here
```

### 4. Build and Run
```bash
npm run build
npm start
```

Your server is now running at http://localhost:3000

### 5. Test the Connection
```bash
curl http://localhost:3000/health-summary
```

You should see your Oura health data.

---

## Detailed Setup

### Oura API Setup

The Oura API uses OAuth 2.0. There are two approaches:

#### Option 1: Personal Access Token (Recommended for Development)
1. Go to https://cloud.ouraring.com/personal-access-tokens
2. Click "Create a New Personal Access Token"
3. Give it a descriptive name (e.g., "Oura Health App")
4. Copy the token and add to `.env`:
   ```env
   OURA_ACCESS_TOKEN=your_token_here
   OURA_REFRESH_TOKEN=  # Leave empty for personal tokens
   ```

#### Option 2: OAuth Flow (For Production)
1. Register your application at https://cloud.ouraring.com/oauth/applications
2. Get your client ID and client secret
3. Set up OAuth redirect URI
4. Implement OAuth flow to get access and refresh tokens
5. Add to `.env`:
   ```env
   OURA_CLIENT_ID=your_client_id
   OURA_CLIENT_SECRET=your_client_secret
   OURA_ACCESS_TOKEN=your_access_token
   OURA_REFRESH_TOKEN=your_refresh_token
   ```

### Spotify Integration Setup

For detailed Spotify setup instructions, see [Spotify Setup Guide](./spotify-setup.md).

Quick steps:
1. Create Spotify app at https://developer.spotify.com/dashboard
2. Get Client ID and Client Secret
3. Run OAuth flow to get tokens:
   ```bash
   npm run setup-spotify
   ```
4. Add credentials to `.env`:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   SPOTIFY_ACCESS_TOKEN=your_access_token
   SPOTIFY_REFRESH_TOKEN=your_refresh_token
   SPOTIFY_ENABLED=true
   ```

### Govee Lighting Setup

For detailed lighting setup instructions, see [Lighting Setup Guide](./lighting-setup.md).

Quick steps:
1. Download Govee Home app
2. Register your Govee devices
3. Apply for API key in app: Settings → Account → Apply for API Key
4. Add to `.env`:
   ```env
   GOVEE_API_KEY=your_api_key
   LIGHTING_ENABLED=true
   ```

### Google Docs Oura Log

The daily Oura export can publish to a Google Doc in the same date-oriented form
as the Hevy Training Log. The application uses a service account so it works from
either your local server or AWS Lambda.

1. In Google Cloud, create a service account and enable the Google Docs API.
2. Create or select the Google Doc that will hold the Oura daily log.
3. Share that Doc with the service account email as an Editor.
4. Add the following to `.env`. Keep the private key on one line with literal
   `\\n` characters for line breaks:

   ```env
   GOOGLE_OURA_DOCUMENT_ID=your_google_doc_id
   GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project-id.iam.gserviceaccount.com
   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
   ```

When Oura sleep and readiness data are fresh, the scheduled workflow writes an
entry such as `Oura Daily Summary: 2026-07-16`. Reprocessing the day replaces the
matching marked entry instead of adding a duplicate.

### Oura Webhooks

Webhooks replace routine polling once the Lambda deployment is public. The GET
and POST endpoints are separate from the general Express REST API; the POST
endpoint validates Oura's HMAC signature over the raw request body, rejects
requests more than five minutes old or duplicate deliveries, and queues valid
events for later work.

1. Generate a high-entropy verification token and set it with the other Oura
   credentials. Do not commit it:

   ```env
   OURA_WEBHOOK_VERIFICATION_TOKEN=replace-with-a-random-secret
   OURA_WEBHOOK_CALLBACK_URL=https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/dev/oura-webhook
   OURA_WEBHOOK_EVENT_TYPES=update
   ```

2. Deploy with `npm run deploy`. Copy the deployed API Gateway URL into
   `OURA_WEBHOOK_CALLBACK_URL`, including the stage and `/oura-webhook` path.
3. Create missing subscriptions (safe to re-run):

   ```bash
   npm run manage:oura-webhooks
   ```

   The command subscribes to `sleep`, `daily_readiness`, `daily_activity`, and
   `daily_resilience` updates using the configured callback URL. Oura verifies
   the GET endpoint during creation.

4. Send an Oura test event and check CloudWatch for a generic queued-event log.
   Event payloads, signatures, client secrets, and verification tokens are never
   written to logs.

The queue consumer fetches the exact day identified by each verified event. It
does not publish a final entry until both sleep and readiness are present;
later activity and resilience events replace the marked entry for that day.

Once per day, a reconciliation Lambda rechecks the previous seven calendar
days. This repairs missed webhooks, delayed mobile syncs, and failed exports
without making polling the normal ingestion path. To re-export a particular
day on demand, run:

```bash
npm run export:oura -- --date YYYY-MM-DD
```

---

## Alexa Skill Setup

### 1. Create Alexa Skill

1. Go to https://developer.amazon.com/alexa/console/ask
2. Click "Create Skill"
3. Skill name: "Oura Health"
4. Choose "Custom" model
5. Choose "Provision your own" backend

### 2. Configure Interaction Model

1. In the Build tab, go to JSON Editor
2. Copy contents of `alexa-interaction-model.json` from this project
3. Paste into the JSON Editor
4. Click "Save Model"
5. Click "Build Model"

### 3. Configure Endpoint

**For Local Testing (with ngrok):**

1. Start your server:
   ```bash
   npm start
   ```

2. In a new terminal, start ngrok:
   ```bash
   ngrok http 3000
   ```

3. Copy the HTTPS URL from ngrok (e.g., `https://abc123.ngrok.io`)
4. In Alexa Console, go to Endpoint
5. Select "HTTPS"
6. Paste your ngrok URL
7. Select certificate type: "My development endpoint is a sub-domain..."

**For Production (Lambda or VPS):**

1. Deploy to AWS Lambda or your VPS with SSL certificate
2. Add the HTTPS endpoint URL
3. Select appropriate certificate type

### 4. Test Your Skill

1. Go to Test tab in Alexa Console
2. Enable testing for "Development"
3. Try voice commands:
   - "Alexa, open Oura Health"
   - "Alexa, ask Oura Health what was my sleep score"
   - "Alexa, ask Oura Health give me my health summary"

---

## Local Development

### Running in Development Mode

```bash
npm run dev
```

This runs the server with hot-reloading using `ts-node-dev`.

### Testing Locally with ngrok

**Terminal 1:**
```bash
npm start
```

**Terminal 2:**
```bash
ngrok http 3000
```

Use the ngrok HTTPS URL as your Alexa skill endpoint.

### Available Commands

**Build:**
```bash
npm run build
```

**Run production server:**
```bash
npm start
```

**Run development server:**
```bash
npm run dev
```

**Test API connection:**
```bash
npm run test-api
```

**Setup Spotify playlist:**
```bash
npm run setup-spotify
```

---

## API Endpoints

### Health Data
- `GET /health-summary` - Get today's Oura summary
- `GET /spotify/data-freshness` - Check if Oura data is fresh

### Spotify Control
- `POST /generate-playlist` - Manually generate playlist
- `GET /spotify/playlist-status` - Check playlist info
- `GET /spotify/config` - View Spotify configuration

### Lighting Control
- `POST /lighting/scene/:name` - Apply specific lighting scene
- `POST /lighting/sync-to-oura` - Sync lights to health scores
- `POST /lighting/on` - Turn on all lights
- `POST /lighting/off` - Turn off all lights
- `GET /lighting/scenes` - List available scenes

### Smart Home
- `POST /trigger-smart-home` - Manually trigger smart home actions
- `GET /smart-home/config` - View smart home configuration

### Example Requests

**Get health summary:**
```bash
curl http://localhost:3000/health-summary
```

**Generate playlist:**
```bash
curl -X POST http://localhost:3000/generate-playlist
```

**Apply lighting scene:**
```bash
curl -X POST http://localhost:3000/lighting/scene/high_energy
```

**Trigger smart home actions:**
```bash
curl -X POST http://localhost:3000/trigger-smart-home
```

---

## Smart Home Configuration

The app includes smart home automation based on health scores. Configure actions in `src/config/smartHomeConfig.json`.

### Supported Action Types

1. **Lighting Scene** - Apply Govee lighting scene
2. **Lighting Energy** - Apply energy-based lighting
3. **Custom Actions** - Extend with your own integrations

### Adding Custom Actions

Example action in `smartHomeConfig.json`:
```json
{
  "id": "poor-sleep-recovery",
  "name": "Recovery mode on poor sleep",
  "actionType": "lighting_scene",
  "lightingScene": "recovery",
  "condition": {
    "metric": "sleep",
    "operator": "lt",
    "threshold": 70,
    "subMetric": "score"
  }
}
```

---

## Deployment

### Pre-Deployment Checklist

- [ ] Set up all API credentials (Oura, Spotify, Govee)
- [ ] Configure environment variables
- [ ] Build and test locally
- [ ] Set up Alexa skill in Developer Console
- [ ] Configure interaction model
- [ ] Test skill with Alexa device
- [ ] Configure smart home actions
- [ ] Test scheduled automation

### Deployment Options

**Option 1: AWS Lambda (Recommended)**
- Serverless, scales automatically
- Use Serverless Framework or AWS SAM
- Set up environment variables in Lambda
- Configure API Gateway endpoint
- Use CloudWatch for logging

**Option 2: VPS (DigitalOcean, AWS EC2, etc.)**
- Install Node.js 18+
- Clone repository
- Install dependencies: `npm install`
- Set up environment variables
- Use PM2 for process management: `pm2 start dist/index.js`
- Set up SSL certificate (Let's Encrypt)
- Configure firewall (allow port 443)

**Option 3: Docker**
- Create Dockerfile (not included, needs to be created)
- Build image
- Deploy to container service

### Environment Variables for Production

Ensure these are set in production:
```env
NODE_ENV=production
PORT=3000
OURA_ACCESS_TOKEN=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_ACCESS_TOKEN=...
SPOTIFY_REFRESH_TOKEN=...
GOVEE_API_KEY=...
```

---

## Troubleshooting

### "Oura API authentication failed"
- Verify your access token is valid
- Check token hasn't expired
- For personal tokens, regenerate if needed
- For OAuth tokens, check refresh token is working

### "Spotify authentication failed"
- Re-run `npm run setup-spotify` to get fresh tokens
- Verify Client ID and Secret are correct
- Check redirect URI matches Spotify app settings

### "No Govee devices found"
- Verify API key is valid and approved
- Check devices are online in Govee app
- Ensure devices support API control
- Wait up to 24 hours for API key approval

### "Playlist not updating"
- Check `SPOTIFY_ENABLED=true` in `.env`
- Verify Oura data is fresh (check `/spotify/data-freshness`)
- Check server logs for errors
- Ensure playlist ID in `spotifyConfig.json` is correct

### "Lights not changing"
- Check `LIGHTING_ENABLED=true` in `.env`
- Verify Govee API key is valid
- Check devices are online
- Test manually: `curl -X POST http://localhost:3000/lighting/sync-to-oura`

### "Alexa skill not responding"
- Check ngrok is running (for local testing)
- Verify endpoint URL is correct in Alexa Console
- Check server logs for incoming requests
- Test endpoint directly with curl

---

## Next Steps

Once you have the basics working:

1. **Customize Energy Levels**: Adjust thresholds in `spotifyConfig.json` and `lightingConfig.json`
2. **Add Custom Scenes**: Create your own lighting scenes
3. **Configure Smart Home Actions**: Set up conditional automations
4. **Explore Integration**: Read [Integration Overview](./integration-overview.md) to understand how everything works together
5. **Deploy to Production**: Choose a deployment option and go live

For feature-specific guides:
- [Spotify Integration](./spotify-setup.md)
- [Lighting Integration](./lighting-setup.md)
- [System Integration Overview](./integration-overview.md)
- [API Data Types](./api-data-types.md)
