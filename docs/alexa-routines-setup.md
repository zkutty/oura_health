# Alexa Routines Setup Guide

This guide explains how to set up Alexa Routines for Option A deployment, where your Lambda function triggers pre-configured Alexa routines instead of making direct API calls to Govee.

## Overview

With Option A, you:
1. **Pre-configure routines** in the Alexa app (one-time setup)
2. **Trigger routines** from Lambda using the Alexa API
3. **No Govee API key needed** - Alexa already controls your lights
4. **Local network control** - Faster and more reliable

## Prerequisites

- Govee lights already paired with Alexa
- Alexa account with routines capability
- AWS account for Lambda deployment
- Oura Health project configured

## Step 1: Create Alexa Routines

### In the Alexa App:

1. **Open Alexa app** on your phone
2. **Go to Routines** (bottom navigation → More → Routines)
3. **Create the following routines:**

#### Routine 1: "High Energy Scene"
- **When this happens**: (Leave empty - will be triggered programmatically)
- **Add action**: Smart Home → Control device → Select your Govee lights
  - Set brightness to **80-95%**
  - Set color temperature to **5500-6500K** (cool white)
  - Turn on lights
- **Save routine**

#### Routine 2: "Moderate Energy Scene"
- **When this happens**: (Leave empty)
- **Add action**: Smart Home → Control device → Select your Govee lights
  - Set brightness to **70%**
  - Set color temperature to **4500K** (neutral)
  - Turn on lights
- **Save routine**

#### Routine 3: "Low Energy Scene"
- **When this happens**: (Leave empty)
- **Add action**: Smart Home → Control device → Select your Govee lights
  - Set brightness to **40%**
  - Set color temperature to **3500K** (warm white)
  - Turn on lights
- **Save routine**

#### Routine 4: "Very Low Energy Scene"
- **When this happens**: (Leave empty)
- **Add action**: Smart Home → Control device → Select your Govee lights
  - Set brightness to **15%**
  - Set color temperature to **2200K** (very warm/amber)
  - Turn on lights
- **Save routine**

#### Optional: "Evening Wind Down"
- **When this happens**: (Leave empty)
- **Add action**: Smart Home → Control device → Select your Govee lights
  - Set brightness to **25%**
  - Set color temperature to **2200K**
  - Turn on lights
- **Save routine**

### Important Notes:

- **Routine names must match exactly** what's in `lightingConfig.json`:
  ```json
  "routineMapping": {
    "very_high": "High Energy Scene",
    "high": "High Energy Scene",
    "moderate": "Moderate Energy Scene",
    "low": "Low Energy Scene",
    "very_low": "Very Low Energy Scene"
  }
  ```

- **Case-sensitive**: Make sure routine names match exactly (including capitalization)

## Step 2: Configure Lighting Config

Your `src/config/lightingConfig.json` should have:

```json
{
  "enabled": true,
  "provider": "alexa",
  "alexaRoutines": {
    "enabled": true,
    "routineMapping": {
      "very_high": "High Energy Scene",
      "high": "High Energy Scene",
      "moderate": "Moderate Energy Scene",
      "low": "Low Energy Scene",
      "very_low": "Very Low Energy Scene"
    }
  },
  ...
}
```

## Step 3: Update Environment Variables

In your `.env` file (or AWS Lambda environment variables):

```env
# Remove or comment out Govee API key (no longer needed)
# GOVEE_API_KEY=...

# Add Alexa Skill ID (optional, for future enhancements)
ALEXA_SKILL_ID=your_skill_id_here

# Keep all other variables (Oura, Spotify)
OURA_ACCESS_TOKEN=...
SPOTIFY_CLIENT_ID=...
# etc.
```

## Step 4: Deploy to AWS Lambda

### Install Serverless Framework:

```bash
npm install -g serverless
```

### Configure AWS Credentials:

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region (e.g., us-east-1)
```

### Deploy:

```bash
# Build the project
npm run build

# Deploy to AWS
npm run deploy

# Or deploy to production
npm run deploy:prod
```

### Set Environment Variables:

After deployment, set environment variables in AWS Lambda console or use:

```bash
serverless deploy function -f alexa --update-env VAR_NAME=value
```

## Step 5: Update Alexa Skill Endpoint

1. Go to [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask)
2. Select your "Oura Health" skill
3. Go to **Endpoint** section
4. Select **AWS Lambda ARN**
5. Paste your Lambda function ARN (from deployment output)
6. Click **Save Endpoints**

## Step 6: Test the Integration

### Test Locally (Optional):

You can test the routine triggering logic locally:

```bash
npm run dev
```

Then trigger a lighting scene:

```bash
curl -X POST http://localhost:3000/lighting/sync-to-oura
```

### Test in AWS:

1. Check CloudWatch logs for your Lambda function
2. Wait for scheduled automation (7 AM) or trigger manually
3. Verify routines are triggered in Alexa app activity

## How It Works

### Morning Automation (7 AM):

```
EventBridge triggers Lambda
  → Lambda fetches Oura data
  → Calculates energy level (very_high, high, moderate, low, very_low)
  → Calls AlexaRoutineService.triggerRoutine()
  → Routine name mapped from energy level
  → Alexa routine executes on local network
  → Govee lights change
```

### Current Implementation Status

**Note**: The current `AlexaRoutineService.triggerRoutine()` implementation is a placeholder. Amazon doesn't provide a direct public API to trigger routines programmatically.

**Workarounds:**

1. **Use Alexa Smart Home API** (Recommended for production):
   - Extend your Alexa skill to include Smart Home capability
   - Control devices directly via Smart Home directives
   - This gives you the same control as routines but programmatically

2. **Use Alexa Skills API**:
   - Create a custom intent that triggers routines
   - Call the skill programmatically from Lambda
   - More complex but works with existing routines

3. **Use Virtual Buttons**:
   - Create virtual switches in Alexa
   - Trigger routines when switches turn on
   - Control switches from Lambda

### Recommended Next Step

For production, we recommend implementing **Option B (Smart Home Skill)** which gives you direct device control without needing to trigger routines. However, if you want to stick with Option A, you'll need to implement one of the workarounds above.

## Troubleshooting

### Routines Not Triggering

1. **Check routine names**: Must match exactly (case-sensitive)
2. **Verify routines exist**: Check in Alexa app
3. **Check Lambda logs**: Look for errors in CloudWatch
4. **Verify provider**: Ensure `lightingConfig.json` has `"provider": "alexa"`

### Lambda Function Errors

1. **Check CloudWatch logs**: `serverless logs -f alexa -t`
2. **Verify environment variables**: All required vars set in Lambda
3. **Check IAM permissions**: Lambda needs CloudWatch Logs access

### Lights Not Changing

1. **Verify Govee lights are paired** with Alexa
2. **Test routines manually** in Alexa app
3. **Check routine actions** are configured correctly
4. **Verify lights are online** in Alexa app

## Migration from Govee Direct API

If you're migrating from direct Govee API calls:

1. **Update `lightingConfig.json`**: Change `"provider": "govee"` to `"provider": "alexa"`
2. **Add `alexaRoutines` section** to config
3. **Create routines** in Alexa app
4. **Remove `GOVEE_API_KEY`** from environment variables (optional)
5. **Redeploy** Lambda function

The code automatically detects the provider and uses the appropriate service.

## Next Steps

- Monitor CloudWatch logs for automation execution
- Adjust routine configurations in Alexa app as needed
- Consider implementing Smart Home API for more control (Option B)
- Test all energy level mappings

## Support

For issues:
1. Check CloudWatch logs: `serverless logs -f morningAutomation -t`
2. Verify routines exist and are named correctly
3. Test routines manually in Alexa app
4. Review `lightingConfig.json` configuration
