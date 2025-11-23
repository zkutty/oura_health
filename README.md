# Oura Health Alexa Skill

An Alexa skill that integrates with your Oura Ring health data to provide insights and automate smart home actions based on your sleep, readiness, and activity scores.

## Features

- **Voice Commands**: Ask Alexa about your sleep, readiness, and activity scores
- **Smart Home Automation**: Automatically trigger smart home actions based on your health scores
- **Daily Health Summaries**: Get comprehensive health insights from the night before
- **Automated Actions**: Scheduled checks every morning at 7 AM to evaluate and trigger actions

## Architecture

- **Backend**: Node.js/TypeScript with Express
- **Oura Integration**: Oura API v2 for health data
- **Alexa Skill**: Custom skill with multiple intents
- **Smart Home**: Configurable action system based on health metrics

## Setup

### 1. Prerequisites

- Node.js 18+ and npm
- Oura Ring account with API access
- Alexa Developer account
- AWS account (for hosting the skill or using Lambda)

### 2. Oura API Setup

1. Go to [Oura Cloud](https://cloud.ouraring.com/) and create a developer account
2. Create a new application to get:
   - `OURA_CLIENT_ID`
   - `OURA_CLIENT_SECRET`
3. Obtain OAuth tokens:
   - Use the OAuth flow to get `OURA_ACCESS_TOKEN` and `OURA_REFRESH_TOKEN`
   - You can use the [Oura OAuth guide](https://cloud.ouraring.com/docs/authentication) for this

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

Create a `.env` file in the root directory:

```env
OURA_CLIENT_ID=your_oura_client_id
OURA_CLIENT_SECRET=your_oura_client_secret
OURA_ACCESS_TOKEN=your_oura_access_token
OURA_REFRESH_TOKEN=your_oura_refresh_token

PORT=3000
NODE_ENV=development

ALEXA_SKILL_ID=your_alexa_skill_id

SMART_HOME_ENABLED=true
```

### 5. Build the Project

```bash
npm run build
```

### 6. Run the Server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Alexa Skill Setup

### 1. Create Alexa Skill

1. Go to [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
2. Create a new skill:
   - **Skill name**: Oura Health
   - **Default language**: English (US)
   - **Skill type**: Custom

### 2. Configure Interaction Model

Use the provided `alexa-interaction-model.json` file or create intents manually:

**Intents:**
- `SleepScoreIntent` - Get sleep score
- `ReadinessScoreIntent` - Get readiness score
- `ActivityScoreIntent` - Get activity score
- `HealthSummaryIntent` - Get complete health summary

**Sample Utterances:**

```
SleepScoreIntent what was my sleep score
SleepScoreIntent how did I sleep
SleepScoreIntent tell me my sleep score
SleepScoreIntent sleep score from last night

ReadinessScoreIntent what is my readiness score
ReadinessScoreIntent how ready am I
ReadinessScoreIntent tell me my readiness score

ActivityScoreIntent what was my activity score
ActivityScoreIntent how active was I
ActivityScoreIntent tell me my activity score

HealthSummaryIntent health summary
HealthSummaryIntent give me my health summary
HealthSummaryIntent how was my health
HealthSummaryIntent summary
```

### 3. Configure Endpoint

For development, you can use:
- **HTTPS**: Your public server URL (e.g., ngrok tunnel)
- **Lambda**: Deploy to AWS Lambda

**Using ngrok for local testing:**

```bash
ngrok http 3000
```

Use the ngrok HTTPS URL as your skill endpoint.

### 4. Test Your Skill

You can test the skill using:
- Alexa Developer Console Test tab
- An Alexa-enabled device (after certification)
- The Alexa Simulator

## Smart Home Configuration

Edit `src/config/smartHomeConfig.json` to configure smart home actions:

```json
{
  "enabled": true,
  "actions": [
    {
      "id": "poor-sleep-dim-lights",
      "name": "Dim lights on poor sleep",
      "device": "bedroom_lights",
      "action": "dim_to_30_percent",
      "condition": {
        "metric": "sleep",
        "operator": "lt",
        "threshold": 70,
        "subMetric": "score"
      }
    }
  ]
}
```

### Action Conditions

**Metrics:**
- `sleep` - Sleep-related metrics
- `readiness` - Readiness metrics
- `activity` - Activity metrics
- `combined` - Average of all scores

**Operators:**
- `lt` - Less than
- `lte` - Less than or equal
- `gt` - Greater than
- `gte` - Greater than or equal
- `eq` - Equal to

**Sub-metrics for sleep:**
- `score` - Sleep score (0-100)
- `duration` - Total sleep duration (hours)
- `efficiency` - Sleep efficiency percentage

**Sub-metrics for readiness:**
- `score` - Readiness score (0-100)
- `resting_heart_rate` - Resting heart rate (bpm)

**Sub-metrics for activity:**
- `score` - Activity score (0-100)
- `steps` - Number of steps

## API Endpoints

### GET `/health`
Health check endpoint

### POST `/alexa`
Alexa skill endpoint

### GET `/health-summary`
Get yesterday's health summary

### POST `/trigger-smart-home`
Manually trigger smart home action evaluation

### GET `/smart-home/config`
Get current smart home configuration

### POST `/smart-home/action`
Add a new smart home action

### DELETE `/smart-home/action/:id`
Remove a smart home action

## Scheduled Automation

The app automatically runs health checks every morning at 7 AM and evaluates smart home actions based on your scores from the night before. You can customize this schedule in `src/index.ts`.

## Deployment

### Option 1: AWS Lambda

1. Package your code:
```bash
npm run build
zip -r function.zip dist/ node_modules/ package.json
```

2. Create a Lambda function in AWS
3. Upload the zip file
4. Set the handler to `index.handler`
5. Configure API Gateway as a trigger
6. Use the API Gateway URL as your Alexa skill endpoint

### Option 2: VPS/Cloud Server

1. Build the project: `npm run build`
2. Set up PM2 or similar process manager:
```bash
npm install -g pm2
pm2 start dist/index.js --name oura-health
```

3. Configure nginx as a reverse proxy
4. Set up SSL certificate (required for Alexa)

## Example Voice Commands

- "Alexa, open Oura Health"
- "Alexa, ask Oura Health what was my sleep score"
- "Alexa, ask Oura Health how ready am I"
- "Alexa, ask Oura Health give me my health summary"

## Troubleshooting

### Oura API Issues

- Verify your access token is valid
- Check that your OAuth tokens haven't expired
- Ensure your Oura app has the correct scopes

### Alexa Skill Issues

- Verify your endpoint URL is HTTPS and publicly accessible
- Check that your skill ID matches in the code
- Ensure your interaction model is properly configured

### Smart Home Actions Not Triggering

- Check that `SMART_HOME_ENABLED=true` in your `.env`
- Verify your action conditions match your health scores
- Check the logs for any errors

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
