/**
 * Provisions all required tabs and headers in the configured Google Sheet.
 *
 * Prereqs:
 *   - GOOGLE_SERVICE_ACCOUNT_KEY_PATH (or GOOGLE_SERVICE_ACCOUNT_KEY_JSON) set in .env
 *   - GOOGLE_SHEETS_SPREADSHEET_ID set in .env (sheet must already be shared with
 *     the service account email as Editor)
 *
 * Usage: npm run setup-sheets
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { OuraService } from '../src/services/ouraService';
import { GoogleSheetsService } from '../src/services/googleSheetsService';
import { SheetsExportService, DEFAULT_SHEETS_CONFIG, SheetsExportConfig } from '../src/services/sheetsExportService';

dotenv.config();

async function main() {
  const configPath = path.join(__dirname, '..', 'src', 'config', 'sheetsConfig.json');
  const config: SheetsExportConfig = {
    ...DEFAULT_SHEETS_CONFIG,
    ...(fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {}),
  };
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    config.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }

  if (!config.spreadsheetId) {
    console.error('GOOGLE_SHEETS_SPREADSHEET_ID is not set. Aborting.');
    process.exit(1);
  }

  const sheets = new GoogleSheetsService();
  const sa = sheets.getServiceAccountEmail();
  if (sa) {
    console.log(`Using service account: ${sa}`);
    console.log('  → Make sure the spreadsheet is shared with this email as Editor.');
  }

  const oura = new OuraService();
  const exporter = new SheetsExportService(oura, sheets, config);

  console.log(`Provisioning tabs in spreadsheet ${config.spreadsheetId}...`);
  await exporter.ensureSpreadsheetSetup();
  console.log(`✓ Done. Open: https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
