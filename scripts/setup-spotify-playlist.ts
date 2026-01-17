import dotenv from 'dotenv';
import { SpotifyService } from '../src/services/spotifyService';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

/**
 * Setup script to create the initial "Daily Health Mix" playlist
 *
 * This script will:
 * 1. Authenticate with Spotify
 * 2. Create a new playlist called "Daily Health Mix"
 * 3. Add a description explaining the automation
 * 4. Output the playlist ID to add to spotifyConfig.json
 * 5. Optionally update the config file automatically
 */

async function setupSpotifyPlaylist() {
  console.log('=== Spotify Playlist Setup ===\n');

  // Check if Spotify credentials are configured
  if (!process.env.SPOTIFY_ACCESS_TOKEN) {
    console.error('❌ Error: SPOTIFY_ACCESS_TOKEN not found in .env file');
    console.log('\nPlease follow these steps:');
    console.log('1. Go to https://developer.spotify.com/dashboard');
    console.log('2. Create a new app');
    console.log('3. Get your Client ID and Client Secret');
    console.log('4. Set up OAuth flow to get access and refresh tokens');
    console.log('5. Add these to your .env file:');
    console.log('   SPOTIFY_CLIENT_ID=your_client_id');
    console.log('   SPOTIFY_CLIENT_SECRET=your_client_secret');
    console.log('   SPOTIFY_ACCESS_TOKEN=your_access_token');
    console.log('   SPOTIFY_REFRESH_TOKEN=your_refresh_token');
    process.exit(1);
  }

  try {
    const spotifyService = new SpotifyService();

    console.log('✓ Connected to Spotify API\n');

    // Create the playlist
    const playlistName = 'Daily Health Mix';
    const playlistDescription =
      '🎵 Automatically updated daily based on your Oura Ring health scores. ' +
      'Music adapts to your energy level - from calming recovery tunes to high-energy motivation. ' +
      'Powered by Oura Health + Spotify integration.';

    console.log(`Creating playlist: "${playlistName}"...`);

    const playlist = await spotifyService.createPlaylist(
      playlistName,
      playlistDescription,
      false // Private playlist
    );

    console.log(`✓ Playlist created successfully!\n`);
    console.log(`Playlist Details:`);
    console.log(`  Name: ${playlist.name}`);
    console.log(`  ID: ${playlist.id}`);
    console.log(`  URL: https://open.spotify.com/playlist/${playlist.id}`);
    console.log(`  Description: ${playlistDescription}\n`);

    // Ask if user wants to auto-update config
    console.log('Would you like to automatically update spotifyConfig.json with this playlist ID? (y/n)');
    console.log('You can also manually add it to src/config/spotifyConfig.json\n');

    // For automated setup, we'll update the config file
    await updateConfigFile(playlist.id, playlist.name);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\nTroubleshooting:');
    console.log('1. Make sure your Spotify access token is valid');
    console.log('2. Check that you have the required Spotify API scopes:');
    console.log('   - playlist-modify-private');
    console.log('   - playlist-modify-public');
    console.log('   - user-library-read');
    console.log('3. Try refreshing your access token');
    process.exit(1);
  }
}

async function updateConfigFile(playlistId: string, playlistName: string) {
  try {
    const configPath = path.join(__dirname, '../src/config/spotifyConfig.json');

    // Read current config
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData);

    // Update playlist ID and name
    config.targetPlaylistId = playlistId;
    config.targetPlaylistName = playlistName;

    // Write back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('✓ Updated spotifyConfig.json with playlist ID\n');
    console.log('Next steps:');
    console.log('1. Build the project: npm run build');
    console.log('2. Start the server: npm start');
    console.log('3. The playlist will be automatically updated at 7:45 AM daily');
    console.log('4. Or manually trigger: curl -X POST http://localhost:3000/generate-playlist\n');

  } catch (error: any) {
    console.error('❌ Error updating config file:', error.message);
    console.log('\nManually add this to src/config/spotifyConfig.json:');
    console.log(`  "targetPlaylistId": "${playlistId}",`);
    console.log(`  "targetPlaylistName": "${playlistName}",\n`);
  }
}

// Run the setup
setupSpotifyPlaylist().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
