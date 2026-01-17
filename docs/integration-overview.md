# Complete Integration Overview: Oura + Spotify + Lighting

This document explains how your Oura Ring health data drives **both** your Spotify playlists **and** Govee smart lighting in a unified, adaptive system.

## The Big Picture

```
┌──────────────┐
│  Oura Ring   │
│ Health Data  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│   Oura Service                       │
│   - Sleep Score                      │
│   - Readiness Score                  │
│   - Activity Data                    │
└──────┬───────────────────────────────┘
       │
       ├─────────────────┬─────────────────┐
       ▼                 ▼                 ▼
┌─────────────┐   ┌────────────┐   ┌──────────────┐
│  Playlist   │   │  Lighting  │   │ Smart Home   │
│  Service    │   │  Service   │   │   Actions    │
│             │   │            │   │              │
│ • Energy    │   │ • Scenes   │   │ • Triggers   │
│   Mapping   │   │ • Colors   │   │ • Conditions │
│ • Track     │   │ • Sync     │   │              │
│   Selection │   │            │   │              │
└─────┬───────┘   └────┬───────┘   └──────────────┘
      │                │
      ▼                ▼
┌─────────────┐   ┌────────────┐
│   Spotify   │   │   Govee    │
│  Playlist   │   │   Lights   │
│  Updated    │   │  Updated   │
└─────────────┘   └────────────┘
```

## How They Work Together

### 1. Morning Wake-Up (7:00 AM)

**What Happens:**
```
1. Oura data is fetched (sleep, readiness scores)
2. Energy level is calculated (very_low → very_high)
3. Lighting scene is applied immediately
   - High readiness: Bright, cool white (energizing)
   - Low readiness: Dim, warm amber (gentle)
4. Smart home actions are evaluated and triggered
```

**Example Morning Flow:**
- **Readiness: 92, Sleep: 88** → Energy Level: `very_high`
  - **Lights**: 95% brightness, 6500K cool white
  - **Mood**: Energized, ready for peak performance

- **Readiness: 65, Sleep: 72** → Energy Level: `low`
  - **Lights**: 40% brightness, 3500K warm white
  - **Mood**: Gentle wake-up, recovery mode

### 2. Playlist Generation (7:45 AM)

**What Happens:**
```
1. Check if Oura data is fresh (from last night)
2. If not fresh, retry every hour until it is
3. Generate Spotify playlist based on energy level
4. Optionally sync lighting to match playlist energy
5. Lights now reflect both health AND music mood
```

**Example Playlist + Lighting Flow:**
- **Energy Level: `high`**
  - **Playlist**: 30 tracks with energy 0.6-0.9, upbeat, motivational
  - **Lights**: Sync to match - bright, slightly warmer than morning
  - **Result**: Coherent environment for active work

### 3. Music Sync (When Playlist Updates)

**How It Works:**

The lighting adapts to the **audio features** of your tracks:

| Track Feature | Lighting Response |
|--------------|-------------------|
| **High Energy** (0.7-1.0) | Brightness +20%, vibrant colors |
| **Low Energy** (0.0-0.3) | Brightness -15%, muted tones |
| **Happy Valence** (>0.7) | Yellow-orange glow (warm, positive) |
| **Neutral Valence** (0.4-0.7) | Neutral white (focus mode) |
| **Sad Valence** (<0.4) | Blue tint (introspective) |

**Example Track-to-Light Mapping:**
- **Track**: "Eye of the Tiger" (Energy: 0.85, Valence: 0.80)
  - **Lights**: 85% brightness, yellow-orange glow, energetic

- **Track**: "Clair de Lune" (Energy: 0.15, Valence: 0.45)
  - **Lights**: 35% brightness, neutral white, calm

### 4. Evening Wind-Down (9:00 PM)

**What Happens:**
```
1. Lighting automatically transitions to evening scene
2. Very warm color temperature (2200K)
3. Low brightness (25%)
4. Prepares environment for sleep
```

## Energy Level System (Unified Across All Features)

Both Spotify and Lighting use the **same 5-tier energy system**:

### Very High Energy (90+ combined score)
- **Lighting**: 95% brightness, 6500K (peak performance mode)
- **Music**: Rock, EDM, intense (0.7-1.0 energy, 130-180 BPM)
- **When**: Exceptional sleep and readiness, ready to crush it

### High Energy (85+ combined score)
- **Lighting**: 80% brightness, 5500K (energizing cool white)
- **Music**: Dance, electronic, pop (0.6-0.9 energy, 120-150 BPM)
- **When**: Great recovery, feeling motivated and active

### Moderate Energy (75-84 combined score)
- **Lighting**: 70% brightness, 4500K (neutral focus)
- **Music**: Indie pop, alternative (0.4-0.7 energy, 100-130 BPM)
- **When**: Normal state, balanced day

### Low Energy (70-74 combined score)
- **Lighting**: 40% brightness, 3500K (gentle warm white)
- **Music**: Folk, jazz, lo-fi (0.2-0.5 energy, 80-110 BPM)
- **When**: Suboptimal recovery, taking it easy

### Very Low Energy (<70 combined score)
- **Lighting**: 15% brightness, 2200K + amber (recovery mode)
- **Music**: Ambient, chill, classical (0.0-0.3 energy, 60-100 BPM)
- **When**: Poor sleep/readiness, need recovery

## Daily Schedule Overview

```
Time    | Automation           | What Happens
--------|---------------------|-----------------------------------------------
7:00 AM | Morning Automation  | - Fetch Oura scores
        |                     | - Apply lighting based on energy level
        |                     | - Execute smart home actions
        |                     |
7:45 AM | Playlist Generation | - Generate Spotify playlist (with retries)
        |                     | - Optionally sync lighting to playlist energy
        |                     | - Lights now reflect music + health
        |                     |
All Day | Manual Control      | - REST API for on-demand changes
        |                     | - Adjust scenes, brightness, colors
        |                     |
9:00 PM | Evening Wind-Down   | - Transition to sleep-promoting lighting
        |                     | - 25% brightness, 2200K warm
        |                     | - Prepares circadian rhythm for sleep
```

## Configuration Files

### Central Configuration Points

| Feature | Config File | Purpose |
|---------|-------------|---------|
| **Spotify** | `src/config/spotifyConfig.json` | Playlist generation, energy mapping, sources |
| **Lighting** | `src/config/lightingConfig.json` | Lighting scenes, music sync, automation schedule |
| **Smart Home** | `src/config/smartHomeConfig.json` | Conditional actions, triggers |
| **Credentials** | `.env` | API keys for Oura, Spotify, Govee |

### Shared Settings

Both Spotify and Lighting share:
- **Energy level thresholds** (when to switch levels)
- **Oura score weighting** (readiness 60%, sleep 40%)
- **Automation enablement flags**

## REST API: Complete Reference

### Oura Health Data
- `GET /health-summary` - Get today's Oura summary
- `GET /spotify/data-freshness` - Check if data is fresh

### Spotify Control
- `POST /generate-playlist` - Manually generate playlist
- `GET /spotify/playlist-status` - Check playlist info
- `GET /spotify/config` - View Spotify configuration

### Lighting Control
- `POST /lighting/scene/:name` - Apply specific scene
- `POST /lighting/sync-to-oura` - Sync lights to current health scores
- `POST /lighting/on` - Turn on all lights
- `POST /lighting/off` - Turn off all lights
- `GET /lighting/scenes` - List available scenes

### Smart Home
- `POST /trigger-smart-home` - Manually evaluate smart home actions
- `GET /smart-home/config` - View smart home configuration

## Example Use Cases

### Use Case 1: Poor Sleep Recovery

**Scenario**: You had a rough night (Sleep: 65, Readiness: 68)

**What Happens Automatically**:
1. **7:00 AM**: Lights turn on at 20% brightness, warm amber color (recovery scene)
2. **7:45 AM**: Playlist generates with calming ambient/chill music (very_low energy)
3. **Lighting**: Syncs to gentle, low-energy ambiance
4. **Result**: Environment optimized for gentle recovery

### Use Case 2: Peak Performance

**Scenario**: Amazing sleep (Sleep: 92, Readiness: 95)

**What Happens Automatically**:
1. **7:00 AM**: Lights blast at 95% brightness, cool white 6500K (peak mode)
2. **7:45 AM**: Playlist filled with high-energy rock, EDM, workout music
3. **Lighting**: Bright, vibrant, matches the energetic music
4. **Result**: You're energized and ready to tackle the day

### Use Case 3: Manual Override

**Scenario**: It's afternoon, you need to focus

**What You Do**:
```bash
# Switch to focus lighting
curl -X POST http://localhost:3000/lighting/scene/focus

# Or sync to moderate energy
curl -X POST http://localhost:3000/lighting/energy-level \
  -d '{"energyLevel": "moderate"}'
```

### Use Case 4: Evening Wind-Down

**Scenario**: 9 PM, time to prepare for sleep

**What Happens Automatically**:
1. **Lights**: Automatically dim to 25%, warm 2200K
2. **Music**: If you manually want calming music, trigger recovery playlist
3. **Result**: Circadian-friendly environment for better sleep

## No Duplication, Full Integration

### What We Avoided

❌ **NOT**: Separate Python process for lighting
✅ **INSTEAD**: Unified TypeScript service

❌ **NOT**: Different energy mappings for music vs lights
✅ **INSTEAD**: Shared 5-tier system

❌ **NOT**: Duplicate Oura API calls
✅ **INSTEAD**: Single data fetch shared across all services

❌ **NOT**: Competing schedulers
✅ **INSTEAD**: Coordinated automation at 7 AM, 7:45 AM, 9 PM

### Architecture Benefits

1. **Single Source of Truth**: One energy calculation for all systems
2. **Coordinated Updates**: Playlist and lighting change together
3. **Efficient API Usage**: One Oura call serves multiple features
4. **Easy Maintenance**: All TypeScript, one codebase
5. **Consistent Behavior**: Same logic across playlist and lighting

## Customization Guide

### Adjust Energy Thresholds

Want different breakpoints? Edit both configs:

**spotifyConfig.json** (Playlist):
```json
{
  "level": "high",
  "conditions": {
    "readinessThreshold": 80,  // Lower from 85
    "sleepThreshold": 80
  }
}
```

**lightingConfig.json** (Lights):
```json
{
  "high_energy": {
    "energyLevels": ["high"]  // This will now activate at 80+
  }
}
```

### Disable Music Sync

**In lightingConfig.json**:
```json
{
  "automation": {
    "syncToPlaylist": {
      "enabled": false
    }
  }
}
```

### Change Morning Lighting Time

**In lightingConfig.json**:
```json
{
  "automation": {
    "morningLighting": {
      "time": "6:30"  // Earlier wake-up
    }
  }
}
```

## Monitoring Your System

### Check Current State

```bash
# What's my current energy level based on Oura?
curl http://localhost:3000/spotify/data-freshness

# Is my playlist fresh?
curl http://localhost:3000/spotify/playlist-status

# What scenes are available?
curl http://localhost:3000/lighting/scenes
```

### Server Logs

Watch for these indicators:
```
✓ Applied very_high lighting scene to 3 device(s)
✓ Successfully generated playlist: Daily Health Mix
✓ Synced lighting to high energy level (3 devices)
```

## Troubleshooting

### Lights Not Changing

1. Check `GOVEE_API_KEY` in `.env`
2. Verify `lightingConfig.json` → `enabled: true`
3. Check logs for errors
4. Test manually: `curl -X POST http://localhost:3000/lighting/sync-to-oura`

### Playlist Generated But Lights Don't Sync

1. Check `lightingConfig.json` → `automation.syncToPlaylist.enabled`
2. Ensure Govee devices are online
3. Check server logs for sync attempts

### Morning Automation Not Running

1. Verify server is running at 7 AM
2. Check cron scheduler in logs
3. Ensure Oura data is available

## Next Steps

1. **Run for a few days**: Observe how energy levels map to your scores
2. **Tune thresholds**: Adjust based on your typical score ranges
3. **Customize scenes**: Add personal lighting preferences
4. **Experiment with music sync**: Try different valence-to-color mappings
5. **Add Alexa commands**: Voice control for lighting (optional)

## Summary

You now have a **unified, adaptive system** where:
- **One source** (Oura Ring) drives multiple outputs
- **Consistent energy levels** across music and lighting
- **Automatic daily adjustments** based on your health
- **Music-reactive lighting** that matches your playlist mood
- **Manual control** when you need to override automation

Your environment now **adapts to you**, not the other way around!
