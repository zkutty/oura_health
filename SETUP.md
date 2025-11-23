# Setup Guide

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up Oura API credentials:**
   - Go to https://cloud.ouraring.com/
   - Create an application
   - Get your client ID and secret
   - Obtain OAuth tokens (access token and refresh token)

3. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` with your credentials.

4. **Build and run:**
   ```bash
   npm run build
   npm start
   ```

5. **Set up Alexa Skill:**
   - Follow instructions in README.md
   - Use `alexa-interaction-model.json` for the interaction model
   - Configure endpoint to point to your server (use ngrok for local testing)

## Oura API Token Setup

The Oura API uses OAuth 2.0. You'll need to:

1. Register your application at https://cloud.ouraring.com/personal-access-tokens
2. Get a personal access token (simpler) OR set up OAuth flow (for production)

For development, you can use a personal access token:
- Go to Oura Cloud Settings
- Generate a personal access token
- Use it as `OURA_ACCESS_TOKEN` (you can leave refresh token empty for personal tokens)

For production with OAuth:
- Set up OAuth redirect URI
- Implement OAuth flow to get tokens
- Store tokens securely

## Testing Locally

1. Start the server:
   ```bash
   npm run dev
   ```

2. Start ngrok:
   ```bash
   ngrok http 3000
   ```

3. Use the ngrok HTTPS URL as your Alexa skill endpoint

4. Test in Alexa Developer Console

## Smart Home Integration

The app includes a smart home service that can trigger actions based on health scores. Currently, it's set up as a framework - you'll need to integrate with your specific smart home platform:

### Option 1: Alexa Smart Home API
- Use Alexa Smart Home API to control devices
- Requires additional setup in Alexa Developer Console

### Option 2: Home Automation Platforms
- Integrate with Home Assistant, SmartThings, etc.
- Update `smartHomeService.ts` to use their APIs

### Option 3: Alexa Routines
- Trigger Alexa routines programmatically
- Use Alexa API or IFTTT integration

## Example Smart Home Action

To create a new smart home action via API:

```bash
curl -X POST http://localhost:3000/smart-home/action \
  -H "Content-Type: application/json" \
  -d '{
    "id": "custom-action",
    "name": "Custom Action",
    "device": "your_device",
    "action": "your_action",
    "condition": {
      "metric": "sleep",
      "operator": "lt",
      "threshold": 70,
      "subMetric": "score"
    }
  }'
```

## Deployment Checklist

- [ ] Set up Oura API credentials
- [ ] Configure environment variables
- [ ] Build and test locally
- [ ] Set up Alexa skill in Developer Console
- [ ] Configure interaction model
- [ ] Set up HTTPS endpoint (Lambda or VPS with SSL)
- [ ] Test skill with Alexa device
- [ ] Configure smart home actions
- [ ] Set up monitoring/logging
- [ ] Test scheduled automation
