# Oura Health Integration System

## Build and deployment

`npm run build` produces deployable JavaScript and copies runtime configuration
into `dist/config`. Use `npm run package` to validate the Lambda artifact without
deploying, or `npm run deploy` to build and deploy it.

A comprehensive health automation system that integrates your Oura Ring data with Spotify, smart lighting, and Alexa to create an adaptive environment based on your sleep, readiness, and activity scores.

## Features

### Voice Control (Alexa)
- Ask Alexa about your sleep, readiness, and activity scores
- Get daily health summaries
- Trigger playlist generation and lighting changes

### Adaptive Music (Spotify)
- Daily playlist generation at 7:45 AM based on your health scores
- High readiness → energetic music, low readiness → calming music
- Smart retry system ensures fresh overnight data
- Pulls from your saved tracks, playlists, and Spotify recommendations

### Smart Lighting (Govee)
- Automatic morning lighting based on health scores (7 AM)
- Music-synchronized lighting that adapts to playlist energy and mood
- Evening wind-down automation (9 PM)
- Manual control via REST API or Alexa

### Smart Home Automation
- Configurable conditional actions based on health metrics
- Scheduled morning automation (7 AM)
- Extensible framework for custom integrations

### Daily Google Sheets Export
- Pulls your Oura data every morning into a Google Sheet in your Drive
- Structured tabs (`Daily Summary`, `Sleep`, `Readiness`, `Activity`,
  `Resilience`, `Workouts`) plus a `Raw JSON` tab for full-fidelity history
- Idempotent upsert by date — re-runs update rows in place, no duplicates
- Designed so you can point Claude at the sheet for trend analysis. See
  [Sheets Setup Guide](docs/sheets-setup.md).

### Daily Google Docs Log
- Publishes a date-specific sleep, readiness, and activity summary to one Google
  Doc, replacing the same date on re-runs
- Includes readable scores and machine-readable JSON for ChatGPT or Claude
- Uses the same service-account access pattern as the Sheets exporter

## Quick Start

```bash
# Install dependencies
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your Oura, Spotify, and Govee API keys

# Build and run
npm run build
npm start
```

Visit http://localhost:3000/health-summary to verify your Oura connection.

For detailed setup instructions, see [Setup Guide](docs/setup.md).

## Google Docs Oura Log

Set `GOOGLE_OURA_DOCUMENT_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, then share the target Doc with the service
account as an Editor. The scheduled Oura sync writes an AI-ready daily entry to
that document.

You can also run an export manually:

```bash
npm run export:oura -- --date 2026-07-16
```

The command writes a local JSON artifact under `data/exports/oura/` and publishes
the same record to Google Docs when the Google credentials are configured.

## Architecture

- **Backend**: Node.js/TypeScript with Express
- **Health Data**: Oura API v2 with OAuth token management
- **Music**: Spotify Web API with playlist generation algorithms
- **Lighting**: Govee API with scene management and music sync
- **Voice Control**: Custom Alexa skill with multiple intents
- **Automation**: node-cron for scheduled tasks (7 AM, 7:45 AM, 9 PM)

## Documentation

### Setup Guides
- **[Complete Setup Guide](docs/setup.md)** - Comprehensive setup instructions for Oura, Spotify, Govee, and Alexa
- **[Spotify Integration](docs/spotify-setup.md)** - Detailed Spotify playlist generation setup
- **[Lighting Integration](docs/lighting-setup.md)** - Govee smart lighting configuration

### System Overview
- **[Integration Overview](docs/integration-overview.md)** - How Oura, Spotify, and Lighting work together
- **[API Data Types](docs/api-data-types.md)** - API reference and data structures

## How It Works

### Morning Automation (7:00 AM)
1. Fetches your Oura sleep and readiness scores from last night
2. Calculates energy level (very_low → very_high)
3. Applies lighting scene based on energy level
4. Executes any configured smart home actions

### Playlist Generation (7:45 AM)
1. Checks if Oura data is fresh (from last night)
2. Generates Spotify playlist matching your energy level
3. Pulls tracks from your library, playlists, and recommendations
4. Optionally syncs lighting to match playlist mood

### Throughout the Day
- Manual control via REST API
- Alexa voice commands
- Music-synchronized lighting

### Evening Wind-Down (9:00 PM)
- Automatically transitions to sleep-promoting lighting
- Warm color temperature (2200K)
- Low brightness (25%)

## Energy Level System

The system uses a unified 5-tier energy mapping for both music and lighting:

| Energy Level | Conditions | Music Style | Lighting |
|-------------|-----------|-------------|----------|
| **Very High** | Readiness ≥90 AND Sleep ≥90 | Rock, EDM, intense | 95% brightness, 6500K cool white |
| **High** | Readiness ≥85 OR Sleep ≥85 | Dance, pop, upbeat | 80% brightness, 5500K |
| **Moderate** | Readiness ≥75 AND Sleep ≥80 | Indie, alternative | 70% brightness, 4500K |
| **Low** | Readiness ≥70 OR Sleep ≥75 | Folk, jazz, lo-fi | 40% brightness, 3500K warm |
| **Very Low** | Below thresholds | Ambient, classical, chill | 15% brightness, 2200K amber |

## REST API

### Health Data
- `GET /health-summary` - Get today's Oura summary
- `GET /spotify/data-freshness` - Check if data is fresh

### Spotify Control
- `POST /generate-playlist` - Generate playlist
- `GET /spotify/playlist-status` - Playlist info
- `GET /spotify/config` - View configuration

### Lighting Control
- `POST /lighting/scene/:name` - Apply scene
- `POST /lighting/sync-to-oura` - Sync to health
- `POST /lighting/on` - Turn on lights
- `POST /lighting/off` - Turn off lights
- `GET /lighting/scenes` - List scenes

### Smart Home
- `POST /trigger-smart-home` - Trigger actions
- `GET /smart-home/config` - View config

### Google Sheets Export
- `POST /sheets/sync` - Sync recent days into the configured spreadsheet
- `POST /sheets/sync-range` - Sync an explicit `{start,end}` window
- `POST /sheets/setup` - Ensure tabs/headers exist
- `GET /sheets/config` - View sheets export configuration

## Configuration Files

All behavior is configuration-driven:

- **`src/config/spotifyConfig.json`** - Playlist generation, energy mapping, music sources
- **`src/config/lightingConfig.json`** - Lighting scenes, music sync, automation schedule
- **`src/config/smartHomeConfig.json`** - Conditional actions and triggers
- **`.env`** - API credentials for Oura, Spotify, Govee

## Example Voice Commands

- "Alexa, open Oura Health"
- "Alexa, ask Oura Health what was my sleep score"
- "Alexa, ask Oura Health how ready am I"
- "Alexa, ask Oura Health give me my health summary"

## Example Usage

### Morning Flow (Automatic)
```
7:00 AM → Oura data fetched → Lighting applied based on energy level
7:45 AM → Playlist generated with matching music → Lights sync to music
```

### Manual Control
```bash
# Generate playlist on demand
curl -X POST http://localhost:3000/generate-playlist

# Apply specific lighting scene
curl -X POST http://localhost:3000/lighting/scene/workout

# Sync lights to current health scores
curl -X POST http://localhost:3000/lighting/sync-to-oura

# Get current health summary
curl http://localhost:3000/health-summary
```

## Customization

All features are highly customizable through configuration files:

- **Adjust energy thresholds** - Change when each level activates
- **Modify music preferences** - Add genres, adjust audio feature targets
- **Custom lighting scenes** - Create your own scene definitions
- **Automation schedule** - Change timing of automated tasks
- **Smart home actions** - Add conditional automations

See [Setup Guide](docs/setup.md) for detailed customization instructions.

## Troubleshooting

For detailed troubleshooting, see:
- [Setup Guide - Troubleshooting](docs/setup.md#troubleshooting)
- [Spotify Setup - Troubleshooting](docs/spotify-setup.md#troubleshooting)
- [Lighting Setup - Troubleshooting](docs/lighting-setup.md#troubleshooting)

Quick fixes:
- **Oura API issues**: Regenerate personal access token
- **Spotify not working**: Run `npm run setup-spotify` again
- **Lights not responding**: Verify Govee API key is approved (takes up to 24 hours)
- **Playlist not updating**: Check data freshness at `/spotify/data-freshness`

## Project Structure

```
oura_health/
├── src/
│   ├── config/             # Configuration files
│   │   ├── spotifyConfig.json
│   │   ├── lightingConfig.json
│   │   └── smartHomeConfig.json
│   ├── handlers/           # Alexa intent handlers
│   ├── services/           # Business logic services
│   │   ├── ouraService.ts
│   │   ├── spotifyService.ts
│   │   ├── goveeService.ts
│   │   ├── playlistService.ts
│   │   ├── lightingService.ts
│   │   └── smartHomeService.ts
│   ├── utils/              # Utilities
│   └── index.ts            # Main application
├── docs/                   # Documentation
└── .env                    # Environment variables (not in git)
```

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Web Framework**: Express
- **Scheduling**: node-cron
- **APIs**: Oura v2, Spotify Web API, Govee API, Alexa Skills Kit
- **HTTP Client**: axios with interceptors for token refresh

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

Built to create an adaptive environment that responds to your body's recovery and readiness, making your living space work *with* you, not against you.
