import dotenv from 'dotenv';
import { OuraExportService } from '../services/ouraExportService';
import { GoogleDocsOuraPublisher } from '../services/googleDocsOuraPublisher';
import { OuraService } from '../services/ouraService';

dotenv.config();

function getRequestedDate(argv: string[]): string | undefined {
  const dateIndex = argv.indexOf('--date');
  if (dateIndex === -1) return undefined;

  const date = argv[dateIndex + 1];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Use --date YYYY-MM-DD.');
  }
  return date;
}

async function main(): Promise<void> {
  const date = getRequestedDate(process.argv.slice(2));
  const ouraService = new OuraService();
  const summary = date ? await ouraService.getSummaryForDate(date) : await ouraService.getTodaySummary();
  const exporter = new OuraExportService();
  const record = exporter.toDailyExport(summary);
  const result = await exporter.exportDailyRecord(record);
  const googleDocsResult = await new GoogleDocsOuraPublisher().publish(record);
  console.log(`Exported Oura summary for ${result.date}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`JSONL: ${result.jsonlPath}`);
  if (googleDocsResult) console.log(`Google Doc: ${googleDocsResult.url}`);
}

main().catch((error: unknown) => {
  console.error('Oura export failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
