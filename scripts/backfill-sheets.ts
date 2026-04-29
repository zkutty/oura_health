/**
 * Backfills historical Oura data into the configured Google Sheet.
 *
 * Usage:
 *   npm run backfill-sheets                 # uses defaultBackfillDays from config
 *   npm run backfill-sheets -- --days=90
 *   npm run backfill-sheets -- --start=2025-01-01 --end=2025-04-01
 *
 * Idempotent: existing rows (keyed by day or record id) are updated in place.
 */
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { OuraService } from '../src/services/ouraService';
import { GoogleSheetsService } from '../src/services/googleSheetsService';
import { SheetsExportService, DEFAULT_SHEETS_CONFIG, SheetsExportConfig } from '../src/services/sheetsExportService';

dotenv.config();

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

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

  let start: string;
  let end: string;
  if (args.start && args.end) {
    start = args.start;
    end = args.end;
  } else {
    const days = args.days ? Number(args.days) : config.defaultBackfillDays;
    const e = new Date();
    const s = new Date();
    s.setDate(s.getDate() - Math.max(0, days - 1));
    start = isoDate(s);
    end = isoDate(e);
  }

  const sheets = new GoogleSheetsService();
  const oura = new OuraService();
  const exporter = new SheetsExportService(oura, sheets, config);

  console.log(`Ensuring tabs/headers exist...`);
  await exporter.ensureSpreadsheetSetup();

  console.log(`Backfilling ${start} → ${end}...`);
  const result = await exporter.syncRange(start, end);

  console.log(`Days processed: ${result.daysProcessed.length ? result.daysProcessed.join(', ') : '(none)'}`);
  for (const [tab, t] of Object.entries(result.totals)) {
    console.log(`  ${tab}: appended ${t.appended}, updated ${t.updated}`);
  }
  console.log(`✓ Done. https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
