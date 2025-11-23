/**
 * Test script to verify Oura API connection and data retrieval
 * Run with: npm run dev -- scripts/test-api.ts
 * Or: ts-node scripts/test-api.ts
 */

import dotenv from 'dotenv';
import { OuraService } from '../src/services/ouraService';

dotenv.config();

async function testOuraAPI() {
  console.log('Testing Oura API connection...\n');

  const ouraService = new OuraService();

  try {
    // Test getting today's summary
    console.log('Fetching today\'s health summary...');
    const summary = await ouraService.getTodaySummary();
    
    console.log('\n=== Health Summary ===');
    console.log(`Date: ${summary.date}`);
    
    if (summary.sleep) {
      const hours = Math.floor(summary.sleep.total_sleep_duration / 3600);
      const minutes = Math.floor((summary.sleep.total_sleep_duration % 3600) / 60);
      console.log(`\nSleep Score: ${summary.sleep.score}/100`);
      console.log(`Duration: ${hours}h ${minutes}m`);
      console.log(`Efficiency: ${summary.sleep.efficiency}%`);
      console.log(`Deep Sleep: ${Math.floor(summary.sleep.deep_sleep_duration / 3600)}h`);
      console.log(`REM Sleep: ${Math.floor(summary.sleep.rem_sleep_duration / 3600)}h`);
    } else {
      console.log('\nNo sleep data available');
    }

    if (summary.readiness) {
      console.log(`\nReadiness Score: ${summary.readiness.score}/100`);
      console.log(`Resting Heart Rate: ${summary.readiness.resting_heart_rate} bpm`);
      console.log(`Recovery Index: ${summary.readiness.recovery_index}`);
    } else {
      console.log('\nNo readiness data available');
    }

    if (summary.activity) {
      console.log(`\nActivity Score: ${summary.activity.score}/100`);
      console.log(`Steps: ${summary.activity.steps}`);
      console.log(`Total Calories: ${summary.activity.calories_total}`);
      console.log(`Active Calories: ${summary.activity.active_calories}`);
    } else {
      console.log('\nNo activity data available');
    }

    console.log('\n✓ API connection successful!');
  } catch (error: any) {
    console.error('\n✗ Error:', error.message);
    console.error('\nPlease check:');
    console.error('1. Your Oura API credentials in .env file');
    console.error('2. That your access token is valid');
    console.error('3. That your Oura account has data for yesterday');
  }
}

testOuraAPI();
