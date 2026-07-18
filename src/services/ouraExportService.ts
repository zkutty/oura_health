import { promises as fs } from 'fs';
import * as path from 'path';
import { OuraDailySummary } from './ouraService';

export interface OuraDailyExport {
  schema_version: 1;
  source: 'oura';
  date: string;
  generated_at: string;
  scores: {
    sleep?: number;
    readiness?: number;
    activity?: number;
    resilience_level?: string;
  };
  contributors: {
    sleep_duration_minutes?: number;
    deep_sleep_minutes?: number;
    rem_sleep_minutes?: number;
    sleep_efficiency?: number;
    resting_heart_rate?: number;
    temperature_deviation?: number;
    hrv_balance?: number;
    recovery_index?: number;
    steps?: number;
    total_calories?: number;
    active_calories?: number;
  };
  derived: {
    missing_sections: string[];
  };
}

export interface OuraExportResult {
  date: string;
  jsonPath: string;
  markdownPath: string;
  jsonlPath: string;
}

export class OuraExportService {
  constructor(private readonly outputDirectory = process.env.OURA_EXPORT_DIR || path.join(process.cwd(), 'exports', 'oura')) {}

  async exportDailySummary(summary: OuraDailySummary): Promise<OuraExportResult> {
    return this.exportDailyRecord(this.toDailyExport(summary));
  }

  async exportDailyRecord(record: OuraDailyExport): Promise<OuraExportResult> {
    const dailyDirectory = path.join(this.outputDirectory, 'daily');
    const jsonPath = path.join(dailyDirectory, `${record.date}.json`);
    const markdownPath = path.join(dailyDirectory, `${record.date}.md`);
    const jsonlPath = path.join(this.outputDirectory, 'oura_daily.jsonl');

    await fs.mkdir(dailyDirectory, { recursive: true });
    await Promise.all([
      fs.writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8'),
      fs.writeFile(markdownPath, this.toDailyMarkdown(record), 'utf8'),
    ]);
    await this.upsertJsonl(jsonlPath, record);

    return { date: record.date, jsonPath, markdownPath, jsonlPath };
  }

  toDailyExport(summary: OuraDailySummary): OuraDailyExport {
    const missingSections = [
      !summary.sleep && 'sleep',
      !summary.readiness && 'readiness',
      !summary.activity && 'activity',
      !summary.resilience && 'resilience',
    ].filter((section): section is string => Boolean(section));

    return {
      schema_version: 1,
      source: 'oura',
      date: summary.date,
      generated_at: new Date().toISOString(),
      scores: this.withDefinedValues({
        sleep: summary.sleep?.score,
        readiness: summary.readiness?.score,
        activity: summary.activity?.score,
        resilience_level: summary.resilience?.level,
      }),
      contributors: this.withDefinedValues({
        sleep_duration_minutes: this.secondsToMinutes(summary.sleep?.total_sleep_duration),
        deep_sleep_minutes: this.secondsToMinutes(summary.sleep?.deep_sleep_duration),
        rem_sleep_minutes: this.secondsToMinutes(summary.sleep?.rem_sleep_duration),
        sleep_efficiency: summary.sleep?.efficiency,
        resting_heart_rate: summary.readiness?.contributors?.resting_heart_rate
          ?? summary.readiness?.resting_heart_rate,
        temperature_deviation: summary.readiness?.temperature_deviation,
        hrv_balance: summary.readiness?.contributors?.hrv_balance
          ?? summary.readiness?.hrv_balance,
        recovery_index: summary.readiness?.contributors?.recovery_index
          ?? summary.readiness?.recovery_index,
        steps: summary.activity?.steps,
        total_calories: summary.activity?.calories_total,
        active_calories: summary.activity?.active_calories,
      }),
      derived: { missing_sections: missingSections },
    };
  }

  private async upsertJsonl(jsonlPath: string, record: OuraDailyExport): Promise<void> {
    let records: OuraDailyExport[] = [];
    try {
      const current = await fs.readFile(jsonlPath, 'utf8');
      records = current
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as OuraDailyExport)
        .filter((existing) => existing.date !== record.date);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    records.push(record);
    records.sort((a, b) => a.date.localeCompare(b.date));
    const temporaryPath = `${jsonlPath}.tmp`;
    await fs.writeFile(temporaryPath, `${records.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
    await fs.rename(temporaryPath, jsonlPath);
  }

  private toDailyMarkdown(record: OuraDailyExport): string {
    const score = (label: string, value: number | string | undefined) => `- ${label}: ${value ?? 'unavailable'}`;
    const missing = record.derived.missing_sections.length > 0
      ? record.derived.missing_sections.join(', ')
      : 'none';

    return [
      `# Oura Daily Summary: ${record.date}`,
      '',
      '## Scores',
      score('Sleep', record.scores.sleep),
      score('Readiness', record.scores.readiness),
      score('Activity', record.scores.activity),
      score('Resilience', record.scores.resilience_level),
      '',
      '## Key Contributors',
      score('Sleep duration (minutes)', record.contributors.sleep_duration_minutes),
      score('Deep sleep (minutes)', record.contributors.deep_sleep_minutes),
      score('REM sleep (minutes)', record.contributors.rem_sleep_minutes),
      score('Sleep efficiency', record.contributors.sleep_efficiency),
      score('Resting heart rate', record.contributors.resting_heart_rate),
      score('Temperature deviation', record.contributors.temperature_deviation),
      score('HRV balance', record.contributors.hrv_balance),
      score('Steps', record.contributors.steps),
      '',
      `Missing sections: ${missing}`,
      `Generated at: ${record.generated_at}`,
      '',
    ].join('\n');
  }

  private secondsToMinutes(seconds: number | undefined): number | undefined {
    return seconds === undefined ? undefined : Math.round(seconds / 60);
  }

  private withDefinedValues<T extends Record<string, unknown>>(values: T): T {
    return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as T;
  }
}
