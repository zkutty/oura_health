# Quick Start Guide

## 5-Minute Setup

### 1. Install & Configure
```bash
npm install
cp .env.example .env
# Edit .env with your Oura API credentials
```

### 2. Get Oura API Credentials
- Visit https://cloud.ouraring.com/personal-access-tokens
- Generate a personal access token
- Add to `.env` as `OURA_ACCESS_TOKEN`

### 3. Test Connection
```bash
npm run test-api
```

### 4. Run Server
```bash
npm run build
npm start
```

### 5. Set Up Alexa Skill

1. Go to https://developer.amazon.com/alexa/console/ask
2. Create new skill: "Oura Health"
3. Import `alexa-interaction-model.json` as interaction model
4. Configure endpoint (use ngrok for local testing)
5. Test in the console

### 6. Test Locally with ngrok
```bash
# Terminal 1
npm start

# Terminal 2
ngrok http 3000

# Use ngrok HTTPS URL as Alexa endpoint
```

## Common Commands

**Build:**
```bash
npm run build
```

**Run in development:**
```bash
npm run dev
```

**Test API connection:**
```bash
npm run test-api
```

**Check health summary via API:**
```bash
curl http://localhost:3000/health-summary
```

**Trigger smart home actions:**
```bash
curl -X POST http://localhost:3000/trigger-smart-home
```

## Voice Commands

Once configured, try:
- "Alexa, open Oura Health"
- "Alexa, ask Oura Health what was my sleep score"
- "Alexa, ask Oura Health give me my health summary"

## Next Steps

- Customize smart home actions in `src/config/smartHomeConfig.json`
- Set up production deployment (Lambda or VPS)
- Configure your smart home platform integration
- Set up monitoring and logging

See `README.md` for full documentation.
