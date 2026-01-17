# Smart Lighting Integration Setup Guide

This guide explains how to set up and use the Govee smart lighting integration with your Oura Health + Spotify system.

## Overview

The lighting integration creates an **adaptive ambient environment** based on your health and music:

- **Oura-based lighting**: Automatically adjusts lighting based on your readiness and sleep scores
- **Music-synchronized lighting**: Lights respond to the energy and mood of your Spotify playlist
- **Scheduled automation**: Morning lighting at 7 AM based on health scores, evening wind-down at 9 PM
- **Manual control**: REST API endpoints for on-demand lighting changes

## How It Works

### Energy Level Mapping

Your Oura scores determine 5 energy levels, each with unique lighting characteristics:

| Energy Level | Conditions | Brightness | Color Temp | Description |
|-------------|-----------|------------|-----------|-------------|
| **Very High** | Readiness ≥90 AND Sleep ≥90 | 95% | 6500K | Peak performance - bright cool white |
| **High** | Readiness ≥85 OR Sleep ≥85 | 80% | 5500K | Energizing cool white |
| **Moderate** | Readiness ≥75 AND Sleep ≥80 | 70% | 4500K | Neutral focus lighting |
| **Low** | Readiness ≥70 OR Sleep ≥75 | 40% | 3500K | Gentle warm white |
| **Very Low** | Readiness <70 OR Sleep <70 | 15% | 2200K + Amber | Recovery mode - minimal restful light |

### Music Sync Features

When enabled, lights dynamically adapt to your music:

- **Energy**: Track energy (0-1) controls brightness (30-90%)
- **Valence** (happiness):
  - Happy (>0.7): Yellow-orange glow
  - Neutral (0.4-0.7): Neutral white
  - Melancholy (<0.4): Blue tint
- **Real-time updates**: Syncs when playlist is generated

## Prerequisites

- **Govee smart lights** with Wi-Fi capability
- **Govee account** with devices registered
- **Govee API key** (see setup below)
- This Oura Health project already installed and working

## Step 1: Get Govee API Access

1. **Download the Govee app** if you haven't already:
   - [iOS](https://apps.apple.com/us/app/govee-home/id1395696823)
   - [Android](https://play.google.com/store/apps/details?id=com.govee.home)

2. **Enable Developer Mode** in your Govee app:
   - Open Govee Home app
   - Go to Settings → Account
   - Tap "Apply for API Key"
   - Fill out the application form (usually approved within 24 hours)

3. **Get your API key**:
   - Once approved, you'll receive an email with your API key
   - Or find it in the app: Settings → Account → API Key

4. **Add to `.env` file**:
   ```env
   GOVEE_API_KEY=your_api_key_here
   LIGHTING_ENABLED=true
   ```

## Step 2: Configure Your Lighting Scenes

Edit `/Users/zbkutlow/oura_health/src/config/lightingConfig.json`:

### Basic Configuration

```json
{
  "enabled": true,
  "provider": "govee",
  "scenes": { ... },
  "musicSync": { ... },
  "automation": {
    "morningLighting": {
      "enabled": true,
      "time": "7:00",
      "basedOnOuraScores": true
    },
    "eveningWindDown": {
      "enabled": true,
      "time": "21:00",
      "scene": "evening_wind_down"
    },
    "syncToPlaylist": {
      "enabled": true,
      "updateInterval": 30000
    }
  }
}
```

### Custom Scene Example

Add your own scene to the `scenes` object:

```json
"my_custom_scene": {
  "name": "Custom Workout Mode",
  "brightness": 100,
  "color": [255, 0, 100],
  "description": "Bright pink for motivation",
  "manual": true
}
```

## Step 3: Test Your Setup

### Build and Start

```bash
npm run build
npm start
```

You should see:
```
Lighting service initialized
Lighting automation: enabled (govee)
  Morning lighting: enabled
  Music sync: enabled
  Evening wind down: enabled
```

### Manual Testing

#### List your Govee devices:
```bash
# This will happen automatically on startup, check logs
```

#### Apply a scene:
```bash
curl -X POST http://localhost:3000/lighting/scene/high_energy
```

#### Sync to current Oura scores:
```bash
curl -X POST http://localhost:3000/lighting/sync-to-oura
```

#### Turn lights on/off:
```bash
curl -X POST http://localhost:3000/lighting/on
curl -X POST http://localhost:3000/lighting/off
```

#### View available scenes:
```bash
curl http://localhost:3000/lighting/scenes
```

## How the System Works

### Morning Routine (7:00 AM)

1. **Oura data check**: Fetches your sleep and readiness scores
2. **Energy level determination**: Calculates your current state
3. **Lighting adjustment**: Applies appropriate scene to all Govee devices
4. **Smart home actions**: Executes any configured smart home automations
5. **Playlist generation** (7:45 AM): Creates your daily playlist
6. **Music sync**: Optionally syncs lighting to playlist energy

### Throughout the Day

**Manual Control**:
- Use REST API endpoints to change scenes
- Control via Alexa if configured
- Automatic evening wind-down at 9 PM (configurable)

**Playlist Updates**:
- When playlist regenerates, lighting can automatically sync to music energy

### Music Sync Algorithm

```
For each track in playlist:
  1. Get audio features (energy, valence, tempo)
  2. Calculate brightness = 30 + (energy * 60)  // 30-90%
  3. Determine color:
     - Happy (valence >0.7): Yellow-orange (hue 0.15)
     - Neutral (0.4-0.7): Use color temperature
     - Sad (valence <0.4): Blue (hue 0.6)
  4. Apply energy level boost/reduction
  5. Update all devices
```

## REST API Reference

### Lighting Endpoints

| Endpoint | Method | Description | Body |
|----------|--------|-------------|------|
| `/lighting/scene/:sceneName` | POST | Apply named scene | - |
| `/lighting/energy-level` | POST | Apply energy-based scene | `{ "energyLevel": "high" }` |
| `/lighting/sync-to-oura` | POST | Sync to current Oura scores | - |
| `/lighting/on` | POST | Turn on all lights | - |
| `/lighting/off` | POST | Turn off all lights | - |
| `/lighting/scenes` | GET | List available scenes | - |
| `/lighting/config` | GET | Get lighting configuration | - |

### Example Requests

**Apply specific scene:**
```bash
curl -X POST http://localhost:3000/lighting/scene/workout
```

**Apply energy level:**
```bash
curl -X POST http://localhost:3000/lighting/energy-level \
  -H "Content-Type: application/json" \
  -d '{"energyLevel": "very_high"}'
```

**Check current configuration:**
```bash
curl http://localhost:3000/lighting/config | jq
```

## Customization Guide

### Adjust Brightness Levels

Edit scene brightness in `lightingConfig.json`:

```json
{
  "high_energy": {
    "brightness": 90  // Change from 80 to 90
  }
}
```

### Change Color Temperatures

```json
{
  "moderate_energy": {
    "colorTemp": 5000  // Cooler white (was 4500)
  }
}
```

### Add RGB Colors

```json
{
  "recovery": {
    "brightness": 15,
    "color": [255, 200, 150]  // Warmer amber
  }
}
```

### Modify Music Sync Sensitivity

```json
{
  "musicSync": {
    "brightnessRange": {
      "min": 40,  // Increase minimum (was 30)
      "max": 85   // Decrease maximum (was 90)
    }
  }
}
```

### Disable Specific Automations

```json
{
  "automation": {
    "morningLighting": {
      "enabled": false  // Disable morning automation
    },
    "syncToPlaylist": {
      "enabled": false  // Disable music sync
    }
  }
}
```

## Integration with Existing Features

### Smart Home Actions

The lighting system integrates with `smartHomeConfig.json`. Example:

```json
{
  "id": "poor-sleep-recovery-lights",
  "name": "Apply recovery lighting on poor sleep",
  "device": "govee_lights",
  "action": "recovery_scene",
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

### Spotify Playlist Integration

Lighting automatically syncs when:
- Playlist is generated at 7:45 AM (if `syncToPlaylist.enabled = true`)
- Manual playlist generation via `/generate-playlist`
- Energy level matches playlist energy level

## Troubleshooting

### "No Govee devices found"

**Causes:**
- Invalid API key
- Devices not registered in Govee app
- API key not approved yet

**Solutions:**
1. Verify API key in `.env` is correct
2. Check devices are online in Govee app
3. Wait for API key approval (up to 24 hours)
4. Ensure devices support API control (check Govee documentation)

### "Failed to control device"

**Causes:**
- Device offline
- API rate limiting
- Incorrect device model

**Solutions:**
1. Check device is online in Govee app
2. Wait a few seconds between commands (rate limit: 60 requests/minute)
3. Restart Govee devices
4. Check server logs for specific error messages

### Lights not syncing to music

**Checklist:**
- `lightingConfig.json` → `musicSync.enabled` = true
- `lightingConfig.json` → `automation.syncToPlaylist.enabled` = true
- Playlist generation is working
- Govee API key is valid
- Check logs for sync attempts

### Scenes not changing based on Oura scores

**Checklist:**
- Oura data is fresh (check `/spotify/data-freshness`)
- `automation.morningLighting.enabled` = true
- Scheduler is running (check logs at 7 AM)
- Energy level thresholds are achievable

## Advanced Features

### Create Conditional Lighting Flows

Combine smart home actions with lighting:

```json
{
  "actions": [
    {
      "id": "great-sleep-celebrate",
      "name": "Celebratory lighting on excellent sleep",
      "actionType": "lighting_scene",
      "lightingScene": "very_high_energy",
      "condition": {
        "metric": "sleep",
        "operator": "gte",
        "threshold": 90
      }
    }
  ]
}
```

### Multiple Automation Times

Add custom cron jobs in `index.ts`:

```typescript
// Afternoon refresh at 2 PM
cron.schedule('0 14 * * *', async () => {
  await lightingService.applyNamedScene('focus');
});
```

### Device-Specific Control

For controlling specific devices (requires code modification):

```typescript
const devices = await goveeService.getDevices();
const bedroomLight = devices.find(d => d.deviceName.includes('Bedroom'));
if (bedroomLight) {
  await goveeService.setBrightness(bedroomLight, 50);
}
```

## Architecture Notes

### Python → TypeScript Migration

The original Python lighting code has been fully ported to TypeScript:
- `alexa_client.py` → Integrated into Alexa skill handlers
- `govee_client.py` → `src/services/goveeService.ts`
- `lighting_orchestrator.py` → `src/services/lightingService.ts`
- `lighting_scenes.yaml` → `src/config/lightingConfig.json`

### No Duplication

The lighting system is **fully integrated** with existing services:
- Uses same energy level mapping as Spotify (5 levels)
- Shares Oura data fetching with playlist generation
- Integrated into SmartHomeService for conditional automation
- No separate processes or duplicate API calls

## What's Next?

- **Monitor daily usage**: Check logs to see when lighting changes occur
- **Adjust thresholds**: Fine-tune energy thresholds based on your typical scores
- **Add scenes**: Create custom scenes for specific activities
- **Experiment with music sync**: Try different valence-to-color mappings
- **Integrate with Alexa**: Add voice commands for lighting control

## Support

For issues:
1. Check server logs for detailed error messages
2. Verify Govee API key is valid and approved
3. Test devices in Govee app to ensure they're online
4. Review `lightingConfig.json` for syntax errors
5. Check Govee API status: https://developer.govee.com/

Enjoy your adaptive, health-synchronized lighting experience!
