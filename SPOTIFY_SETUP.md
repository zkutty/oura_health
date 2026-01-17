# Spotify Integration Setup Guide

This guide will walk you through setting up the Spotify integration for your Oura Health project, which automatically generates a daily playlist based on your health scores.

## Overview

The Spotify integration creates a "Daily Health Mix" playlist that adapts to your Oura Ring health scores:
- **High readiness/sleep** → Energetic, upbeat music
- **Low readiness/sleep** → Calming, relaxing music
- **Automatic daily updates** at 7:45 AM with smart retry logic
- **Music from multiple sources**: Your saved tracks, playlists, Spotify recommendations, and genre playlists

## Prerequisites

- Spotify Premium account (required for API access)
- Oura Ring with active account
- Node.js 18+ installed
- This project already set up and working

## Step 1: Create Spotify Application

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click "Create app"
4. Fill in the details:
   - **App name**: "Oura Health Playlist Generator" (or any name you like)
   - **App description**: "Automatically generates playlists based on Oura Ring health data"
   - **Redirect URI**: `http://localhost:3000/callback`
   - **APIs used**: Select "Web API"
5. Agree to the terms and click "Save"
6. You'll see your **Client ID** and **Client Secret** (click "View client secret")
7. Copy both values - you'll need them in the next step

## Step 2: Get OAuth Tokens

You need to obtain OAuth access and refresh tokens. Here are two methods:

### Method A: Using Spotify OAuth Helper Tool (Recommended)

1. Use a tool like [Spotify OAuth Token Generator](https://spotify-oauth-token-generator.netlify.app/) or create your own simple OAuth flow
2. You'll need these scopes:
   - `playlist-modify-private` - To update your private playlists
   - `playlist-modify-public` - To update public playlists (optional)
   - `user-library-read` - To read your saved tracks
   - `user-read-private` - To read your user profile
   - `playlist-read-private` - To read your playlists
3. After authorization, you'll receive an **access token** and **refresh token**

### Method B: Manual OAuth Flow

If you're comfortable with OAuth, you can implement the authorization code flow:

1. Construct the authorization URL:
   ```
   https://accounts.spotify.com/authorize?
   client_id=YOUR_CLIENT_ID&
   response_type=code&
   redirect_uri=http://localhost:3000/callback&
   scope=playlist-modify-private playlist-modify-public user-library-read user-read-private playlist-read-private
   ```

2. Open this URL in a browser and authorize the app

3. After authorization, you'll be redirected to your callback URL with a `code` parameter

4. Exchange the code for tokens using this curl command:
   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code" \
     -d "code=YOUR_AUTH_CODE" \
     -d "redirect_uri=http://localhost:3000/callback" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET"
   ```

5. The response will contain your `access_token` and `refresh_token`

## Step 3: Configure Environment Variables

1. Open the `.env` file in the project root
2. Add your Spotify credentials:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   SPOTIFY_ACCESS_TOKEN=your_access_token_here
   SPOTIFY_REFRESH_TOKEN=your_refresh_token_here
   SPOTIFY_ENABLED=true
   ```

## Step 4: Create Your Daily Health Mix Playlist

Run the setup script to create the initial playlist on Spotify:

```bash
npm run setup-spotify
```

This script will:
- Connect to Spotify using your credentials
- Create a new playlist called "Daily Health Mix"
- Add a description explaining the automation
- Output the playlist ID
- Automatically update `src/config/spotifyConfig.json` with the playlist ID

**Note:** If you already have a playlist you want to use:
1. Find the playlist ID from the Spotify URL (e.g., `https://open.spotify.com/playlist/PLAYLIST_ID_HERE`)
2. Manually edit `src/config/spotifyConfig.json` and set `targetPlaylistId` to your playlist ID

## Step 5: Build and Start the Server

```bash
# Build the project
npm run build

# Start the server
npm start
```

You should see output indicating that Spotify integration is enabled:
```
Spotify configuration loaded
Spotify playlist automation: enabled
  Target playlist: Daily Health Mix
  Scheduled time: 7:45 (with 5 retries)
```

## Step 6: Test the Integration

### Manual Test
Trigger playlist generation manually:
```bash
curl -X POST http://localhost:3000/generate-playlist
```

### Check Data Freshness
Verify if your Oura data is fresh enough:
```bash
curl http://localhost:3000/spotify/data-freshness
```

### Check Playlist Status
Get current playlist information:
```bash
curl http://localhost:3000/spotify/playlist-status
```

### View Configuration
See your current Spotify configuration:
```bash
curl http://localhost:3000/spotify/config
```

## How It Works

### Energy Level Mapping

The system maps your Oura scores to 5 energy levels:

| Energy Level | Conditions | Music Style | Audio Features |
|-------------|-----------|-------------|----------------|
| **Very High** | Readiness ≥90 AND Sleep ≥90 | Rock, EDM, High-energy | Energy: 0.7-1.0, Tempo: 130-180 BPM |
| **High** | Readiness ≥85 OR Sleep ≥85 | Dance, Electronic, Pop | Energy: 0.6-0.9, Tempo: 120-150 BPM |
| **Moderate** | Readiness ≥75 AND Sleep ≥80 | Indie Pop, Alternative | Energy: 0.4-0.7, Tempo: 100-130 BPM |
| **Low** | Readiness ≥70 OR Sleep ≥75 | Folk, Jazz, Lo-fi | Energy: 0.2-0.5, Tempo: 80-110 BPM |
| **Very Low** | Readiness <70 OR Sleep <70 | Ambient, Chill, Classical | Energy: 0.0-0.3, Tempo: 60-100 BPM |

### Smart Retry Logic

The playlist generation happens at **7:45 AM** every day, with smart retry logic:

1. **Initial attempt at 7:45 AM**: Checks if Oura data is fresh (from last night)
2. **If data is stale**: Retries every hour from 8 AM to 1 PM (max 5 retries)
3. **Data freshness check**: Sleep data must be from within the last 12 hours, and readiness must be from today
4. **Success**: Playlist is updated and retries stop
5. **Failure**: Continues retrying until max retries reached

### Track Selection Process

1. **Collect tracks** from all enabled sources:
   - Your saved/liked songs (40% weight)
   - Your existing playlists (30% weight)
   - Spotify recommendations (20% weight)
   - Genre-specific playlists (10% weight)

2. **Score each track** based on audio features:
   - Energy distance from target (35% weight)
   - Valence/happiness distance from target (30% weight)
   - Tempo distance from target (20% weight)
   - Acousticness distance from target (15% weight)

3. **Apply diversity filters**:
   - Maximum 10% of tracks from the same artist
   - Ensures varied listening experience

4. **Select top 30 tracks** with highest scores

5. **Update playlist** on Spotify

## Customization

### Adjust Energy Thresholds

Edit `src/config/spotifyConfig.json` to change when each energy level activates:

```json
{
  "level": "high",
  "conditions": {
    "readinessThreshold": 85,  // Change this
    "sleepThreshold": 85,       // Change this
    "combinedOperator": "or"    // "and" or "or"
  }
}
```

### Modify Audio Feature Targets

Fine-tune the music characteristics for each energy level:

```json
{
  "audioFeatureTargets": {
    "energy": { "min": 0.6, "max": 0.9, "target": 0.75 },
    "valence": { "min": 0.5, "max": 0.9, "target": 0.75 },
    "tempo": { "min": 120, "max": 150, "target": 135 },
    "acousticness": { "min": 0.0, "max": 0.3, "target": 0.1 }
  }
}
```

### Change Playlist Size

```json
{
  "playlistSize": 30  // Change to any number
}
```

### Adjust Source Weights

Prefer certain music sources over others:

```json
{
  "sources": {
    "savedTracks": { "enabled": true, "weight": 0.5 },      // Increase to 50%
    "userPlaylists": { "enabled": true, "weight": 0.3 },
    "recommendations": { "enabled": true, "weight": 0.15 },
    "genrePlaylists": { "enabled": false, "weight": 0.05 }  // Disable this source
  }
}
```

### Exclude Specific Playlists

Prevent certain playlists from being used as source material:

```json
{
  "sources": {
    "userPlaylists": {
      "enabled": true,
      "weight": 0.3,
      "excludeIds": ["playlist_id_1", "playlist_id_2"]
    }
  }
}
```

## REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/generate-playlist` | POST | Manually trigger playlist generation |
| `/spotify/config` | GET | Get current configuration |
| `/spotify/config` | POST | Update configuration |
| `/spotify/playlist-status` | GET | Get playlist information |
| `/spotify/data-freshness` | GET | Check Oura data freshness |

## Troubleshooting

### Error: "SPOTIFY_ACCESS_TOKEN not found"
- Make sure you've added all credentials to `.env`
- Check that the `.env` file is in the project root directory
- Restart the server after updating `.env`

### Error: "Failed to refresh Spotify access token"
- Your refresh token may be invalid
- Go through the OAuth flow again to get new tokens
- Make sure your Spotify app has the correct redirect URI configured

### Playlist not updating automatically
- Check server logs for error messages
- Verify the cron job is running: look for "Running scheduled playlist generation" in logs
- Ensure your Oura data is syncing properly
- Test data freshness: `curl http://localhost:3000/spotify/data-freshness`

### No tracks matching energy level
- Check if you have enough music in your library
- Try enabling more sources in `spotifyConfig.json`
- Lower the thresholds for the energy level you're targeting
- Check the logs for which sources are being used

### Token expired errors
- The service should automatically refresh tokens
- If it continues failing, get new tokens through OAuth flow
- Check that `SPOTIFY_REFRESH_TOKEN` is set in `.env`

### Playlist has duplicate tracks
- This shouldn't happen as duplicates are filtered
- If it occurs, try regenerating: `curl -X POST http://localhost:3000/generate-playlist`
- Check the logs for any errors during track collection

## Advanced: Alexa Voice Commands (Optional)

You can add voice commands to control playlist generation through Alexa:

1. Update your Alexa skill interaction model
2. Add intents for playlist generation
3. Test with commands like:
   - "Alexa, ask Oura Health to update my playlist"
   - "Alexa, ask Oura Health about my playlist"

See the main README.md for Alexa setup instructions.

## Support

For issues or questions:
1. Check the server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test each component individually using the REST API endpoints
4. Review the configuration file for any syntax errors

## What's Next?

- Monitor the automatic playlist generation over the next few days
- Adjust energy thresholds and audio targets based on the music selected
- Explore different source weights to match your music preferences
- Consider adding custom genre mappings for your favorite music styles

Enjoy your personalized, health-adaptive music experience!
