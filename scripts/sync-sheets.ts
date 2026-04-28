/**
 * Runs a single Oura → Google Sheets sync (default: last few days per config).
 * Useful as a cron entrypoint outside the Express app, or for manual runs.
 *
 * Usage: npm run sync-sheets [-- --days=2]
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { OuraService } from '../src/services/ouraService';
import { GoogleSheetsService } from '../src/services/googleSheetsService';
import { SheetsExportService, DEFAULT_SHEETS_CONFIG, SheetsExportConfig } from '../src/services/sheetsExportService';

dotenv.config();

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .map((a) => a.match(/^--([^=]+)=(.+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]])
  );

  const configPath = path.join(__dirname, '..', 'src', 'config', 'sheetsConfig.json');
  const config: SheetsExportConfig = {
    ...DEFAULT_SHEETS_CONFIG,
    ...(fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {}),
  };
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    config.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }
  if (!config.spreadsheetId) {
    console.error('GOOGLE_SHEETS_SPREADSHEET_ID is not set.');
    process.exit(1);
  }

  const sheets = new GoogleSheetsService();
  const oura = new OuraService();
  const exporter = new SheetsExportService(oura, sheets, config);

  await exporter.ensureSpreadsheetSetup();
  const days = args.days ? Number(args.days) : undefined;
  const result = await exporter.syncRecent(days);

  console.log(`Days: ${result.daysProcessed.join(', ') || '(none)'}`);
  for (const [tab, t] of Object.entries(result.totals)) {
    console.log(`  ${tab}: appended ${t.appended}, updated ${t.updated}`);
  }
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
