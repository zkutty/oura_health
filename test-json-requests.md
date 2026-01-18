# Alexa Skill Test JSON Requests

Use these JSON payloads in the Alexa Developer Console → Test tab → Manual JSON tab to test the new intents.

## Test 1: ResilienceIntent

Test asking for resilience level.

**Voice equivalent:** "Alexa, ask Oura Health what is my resilience"

```json
{
  "version": "1.0",
  "session": {
    "new": true,
    "sessionId": "amzn1.echo-api.session.test-session-id",
    "application": {
      "applicationId": "amzn1.ask.skill.be969732-cd70-4eb1-a7a8-100af42021c8"
    },
    "user": {
      "userId": "amzn1.ask.account.test-user-id"
    }
  },
  "request": {
    "type": "IntentRequest",
    "requestId": "amzn1.echo-api.request.test-request-id",
    "timestamp": "2024-01-18T00:00:00Z",
    "locale": "en-US",
    "intent": {
      "name": "ResilienceIntent",
      "confirmationStatus": "NONE"
    }
  }
}
```

**Expected Response:**
"Your resilience level is [exceptional/strong/solid/adequate/limited] - [description]. This is based on your balance of stress and recovery over the past two weeks."

---

## Test 2: TrendReportIntent

Test asking for 7-day trend analysis.

**Voice equivalent:** "Alexa, ask Oura Health what are my trends"

```json
{
  "version": "1.0",
  "session": {
    "new": true,
    "sessionId": "amzn1.echo-api.session.test-session-id",
    "application": {
      "applicationId": "amzn1.ask.skill.be969732-cd70-4eb1-a7a8-100af42021c8"
    },
    "user": {
      "userId": "amzn1.ask.account.test-user-id"
    }
  },
  "request": {
    "type": "IntentRequest",
    "requestId": "amzn1.echo-api.request.test-request-id",
    "timestamp": "2024-01-18T00:00:00Z",
    "locale": "en-US",
    "intent": {
      "name": "TrendReportIntent",
      "confirmationStatus": "NONE"
    }
  }
}
```

**Expected Response:**
"Here are your seven-day trends. Sleep: currently [X], averaging [Y], [improving/declining/holding steady]. Readiness: currently [X], averaging [Y], [trend]. Activity: currently [X], averaging [Y], [trend]."

---

## Test 3: HealthSummaryIntent (Updated with Resilience)

Test the health summary which now includes resilience.

**Voice equivalent:** "Alexa, ask Oura Health for my health summary"

```json
{
  "version": "1.0",
  "session": {
    "new": true,
    "sessionId": "amzn1.echo-api.session.test-session-id",
    "application": {
      "applicationId": "amzn1.ask.skill.be969732-cd70-4eb1-a7a8-100af42021c8"
    },
    "user": {
      "userId": "amzn1.ask.account.test-user-id"
    }
  },
  "request": {
    "type": "IntentRequest",
    "requestId": "amzn1.echo-api.request.test-request-id",
    "timestamp": "2024-01-18T00:00:00Z",
    "locale": "en-US",
    "intent": {
      "name": "HealthSummaryIntent",
      "confirmationStatus": "NONE"
    }
  }
}
```

**Expected Response:**
"Here is your health summary for [Day]: Sleep score: [X], you slept [Y] hours. Readiness score: [X]. Activity score: [X], with [Y] steps. Resilience: [level]."

---

## Test 4: HelpIntent (Updated with New Capabilities)

Test the help intent which now mentions resilience and trends.

**Voice equivalent:** "Alexa, ask Oura Health for help"

```json
{
  "version": "1.0",
  "session": {
    "new": true,
    "sessionId": "amzn1.echo-api.session.test-session-id",
    "application": {
      "applicationId": "amzn1.ask.skill.be969732-cd70-4eb1-a7a8-100af42021c8"
    },
    "user": {
      "userId": "amzn1.ask.account.test-user-id"
    }
  },
  "request": {
    "type": "IntentRequest",
    "requestId": "amzn1.echo-api.request.test-request-id",
    "timestamp": "2024-01-18T00:00:00Z",
    "locale": "en-US",
    "intent": {
      "name": "AMAZON.HelpIntent",
      "confirmationStatus": "NONE"
    }
  }
}
```

**Expected Response:**
"You can ask me about your sleep score, readiness score, activity score, resilience level, seven-day trends, or get a complete health summary. What would you like to know?"

---

## How to Test

1. Start your local server: `npm start`
2. Start ngrok: `ngrok http 3000`
3. Update Alexa skill endpoint with ngrok URL if needed
4. Go to Alexa Developer Console → Test tab → Manual JSON tab
5. Copy one of the JSON payloads above
6. Paste into the JSON input box
7. Click "Invoke Skill"
8. Check the JSON Output panel for the response
9. Check your ngrok terminal for incoming request logs
10. Check your npm server logs for any errors

## Troubleshooting

**If you get "couldn't find your resilience data":**
- Resilience requires Gen3/Ring 4 with active membership
- Needs at least 5 days of complete data in past 14 days
- New users need 10 days for Oura to establish baselines

**If trend calculations show zeros:**
- Verify you have sleep/readiness/activity data for the past 7 days
- Check server logs for API errors
- Verify Oura API tokens are valid

**If you get 401 errors:**
- Your Oura access token may have expired
- Check .env file has correct OURA_ACCESS_TOKEN
- Token refresh should happen automatically if OURA_REFRESH_TOKEN is set
