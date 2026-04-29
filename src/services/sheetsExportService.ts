import { OuraService } from './ouraService';
import { GoogleSheetsService } from './googleSheetsService';

export interface SheetsExportConfig {
  enabled: boolean;
  spreadsheetId: string;
  /** Cron expression for the daily sync. */
  schedule: string;
  /** How many days back from today to pull on each scheduled run. */
  dailySyncDays: number;
  /** Default backfill window when running the backfill script with no args. */
  defaultBackfillDays: number;
  /** Tabs to populate. Disable any you don't need. */
  tabs: {
    dailySummary: boolean;
    sleep: boolean;
    readiness: boolean;
    activity: boolean;
    resilience: boolean;
    workouts: boolean;
    rawJson: boolean;
  };
}

export const DEFAULT_SHEETS_CONFIG: SheetsExportConfig = {
  enabled: false,
  spreadsheetId: '',
  schedule: '0 6 * * *',
  dailySyncDays: 3,
  defaultBackfillDays: 30,
  tabs: {
    dailySummary: true,
    sleep: true,
    readiness: true,
    activity: true,
    resilience: true,
    workouts: true,
    rawJson: true,
  },
};

const TAB = {
  DAILY_SUMMARY: 'Daily Summary',
  SLEEP: 'Sleep',
  READINESS: 'Readiness',
  ACTIVITY: 'Activity',
  RESILIENCE: 'Resilience',
  WORKOUTS: 'Workouts',
  RAW_JSON: 'Raw JSON',
} as const;

const HEADERS: Record<string, string[]> = {
  [TAB.DAILY_SUMMARY]: [
    'day', 'weekday',
    'sleep_score', 'readiness_score', 'activity_score', 'resilience_level',
    'total_sleep_h', 'deep_sleep_h', 'rem_sleep_h', 'light_sleep_h', 'awake_time_h',
    'sleep_efficiency', 'latency_min', 'average_hrv', 'lowest_hr', 'average_hr',
    'temperature_deviation', 'temperature_trend_deviation',
    'steps', 'active_calories', 'total_calories', 'equivalent_walking_distance_m',
    'high_activity_min', 'medium_activity_min', 'low_activity_min', 'sedentary_time_min',
    'workouts_count', 'workouts_summary',
    'bedtime_start', 'bedtime_end',
    'synced_at',
  ],
  [TAB.SLEEP]: [
    'id', 'day', 'type', 'bedtime_start', 'bedtime_end',
    'total_sleep_duration_h', 'time_in_bed_h', 'awake_time_h',
    'deep_sleep_duration_h', 'rem_sleep_duration_h', 'light_sleep_duration_h',
    'efficiency', 'latency_min', 'restless_periods',
    'average_heart_rate', 'lowest_heart_rate', 'average_hrv', 'average_breath',
    'synced_at',
  ],
  [TAB.READINESS]: [
    'day', 'score', 'temperature_deviation', 'temperature_trend_deviation',
    'c_activity_balance', 'c_body_temperature', 'c_hrv_balance',
    'c_previous_day_activity', 'c_previous_night', 'c_recovery_index',
    'c_resting_heart_rate', 'c_sleep_balance',
    'synced_at',
  ],
  [TAB.ACTIVITY]: [
    'day', 'score',
    'steps', 'active_calories', 'total_calories', 'target_calories',
    'equivalent_walking_distance_m', 'meters_to_target',
    'high_activity_time_min', 'medium_activity_time_min', 'low_activity_time_min',
    'sedentary_time_min', 'resting_time_min', 'non_wear_time_min',
    'high_activity_met_minutes', 'medium_activity_met_minutes', 'low_activity_met_minutes',
    'sedentary_met_minutes', 'average_met_minutes',
    'inactivity_alerts',
    'c_meet_daily_targets', 'c_move_every_hour', 'c_recovery_time',
    'c_stay_active', 'c_training_frequency', 'c_training_volume',
    'synced_at',
  ],
  [TAB.RESILIENCE]: [
    'day', 'level',
    'c_sleep_recovery', 'c_daytime_recovery', 'c_stress',
    'synced_at',
  ],
  [TAB.WORKOUTS]: [
    'id', 'day', 'activity', 'intensity', 'label', 'source',
    'start_datetime', 'end_datetime', 'duration_min',
    'calories', 'distance_m',
    'synced_at',
  ],
  [TAB.RAW_JSON]: [
    'key', 'day', 'endpoint', 'fetched_at', 'json',
  ],
};

const RAW_ENDPOINTS = [
  'daily_sleep',
  'sleep',
  'daily_readiness',
  'daily_activity',
  'daily_resilience',
  'workout',
] as const;

export interface SyncResult {
  range: { start: string; end: string };
  totals: Record<string, { updated: number; appended: number }>;
  daysProcessed: string[];
}

/**
 * Pulls Oura data for a date range and upserts it into structured tabs of a
 * Google Sheet. Designed to be re-run safely: rows are keyed (by `day` or
 * record `id`) so the same day can be synced repeatedly without duplicates.
 */
export class SheetsExportService {
  constructor(
    private readonly oura: OuraService,
    private readonly sheets: GoogleSheetsService,
    private config: SheetsExportConfig
  ) {}

  getConfig(): SheetsExportConfig {
    return this.config;
  }

  loadConfig(config: Partial<SheetsExportConfig>): void {
    this.config = { ...this.config, ...config, tabs: { ...this.config.tabs, ...(config.tabs ?? {}) } };
  }

  /** Provisions all enabled tabs with their headers. Idempotent. */
  async ensureSpreadsheetSetup(): Promise<void> {
    const id = this.requireSpreadsheetId();
    const tabs: string[] = [];
    if (this.config.tabs.dailySummary) tabs.push(TAB.DAILY_SUMMARY);
    if (this.config.tabs.sleep) tabs.push(TAB.SLEEP);
    if (this.config.tabs.readiness) tabs.push(TAB.READINESS);
    if (this.config.tabs.activity) tabs.push(TAB.ACTIVITY);
    if (this.config.tabs.resilience) tabs.push(TAB.RESILIENCE);
    if (this.config.tabs.workouts) tabs.push(TAB.WORKOUTS);
    if (this.config.tabs.rawJson) tabs.push(TAB.RAW_JSON);

    for (const t of tabs) {
      await this.sheets.ensureSheet(id, t, HEADERS[t]);
    }
  }

  /** Convenience wrapper used by the morning cron job. */
  async syncRecent(days?: number): Promise<SyncResult> {
    const n = days ?? this.config.dailySyncDays;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.max(0, n - 1));
    return this.syncRange(toISODate(start), toISODate(end));
  }

  /** Fetches Oura data for [startDate, endDate] inclusive and upserts every tab. */
  async syncRange(startDate: string, endDate: string): Promise<SyncResult> {
    const id = this.requireSpreadsheetId();
    const syncedAt = new Date().toISOString();

    const [
      dailySleep,
      sleep,
      readiness,
      activity,
      resilience,
      workouts,
    ] = await Promise.all([
      this.oura.getDailySleepData(startDate, endDate).catch(() => []),
      this.oura.fetchCollection('sleep', startDate, endDate).catch(() => []),
      this.oura.fetchCollection('daily_readiness', startDate, endDate).catch(() => []),
      this.oura.fetchCollection('daily_activity', startDate, endDate).catch(() => []),
      this.oura.fetchCollection('daily_resilience', startDate, endDate).catch(() => []),
      this.oura.fetchCollection('workout', startDate, endDate).catch(() => []),
    ]);

    const totals: Record<string, { updated: number; appended: number }> = {};

    if (this.config.tabs.dailySummary) {
      const rows = buildDailySummaryRows({
        dailySleep, sleep, readiness, activity, resilience, workouts, syncedAt,
      });
      totals[TAB.DAILY_SUMMARY] = await this.sheets.upsertRows(id, TAB.DAILY_SUMMARY, 0, rows);
    }
    if (this.config.tabs.sleep) {
      const rows = sleep.map((r) => sleepRow(r, syncedAt));
      totals[TAB.SLEEP] = await this.sheets.upsertRows(id, TAB.SLEEP, 0, rows);
    }
    if (this.config.tabs.readiness) {
      const rows = readiness.map((r) => readinessRow(r, syncedAt));
      totals[TAB.READINESS] = await this.sheets.upsertRows(id, TAB.READINESS, 0, rows);
    }
    if (this.config.tabs.activity) {
      const rows = activity.map((r) => activityRow(r, syncedAt));
      totals[TAB.ACTIVITY] = await this.sheets.upsertRows(id, TAB.ACTIVITY, 0, rows);
    }
    if (this.config.tabs.resilience) {
      const rows = resilience.map((r) => resilienceRow(r, syncedAt));
      totals[TAB.RESILIENCE] = await this.sheets.upsertRows(id, TAB.RESILIENCE, 0, rows);
    }
    if (this.config.tabs.workouts) {
      const rows = workouts.map((r) => workoutRow(r, syncedAt));
      totals[TAB.WORKOUTS] = await this.sheets.upsertRows(id, TAB.WORKOUTS, 0, rows);
    }
    if (this.config.tabs.rawJson) {
      const rows: any[][] = [];
      const buckets: Record<string, any[]> = {
        daily_sleep: dailySleep,
        sleep,
        daily_readiness: readiness,
        daily_activity: activity,
        daily_resilience: resilience,
        workout: workouts,
      };
      for (const endpoint of RAW_ENDPOINTS) {
        for (const record of buckets[endpoint] ?? []) {
          const day = record?.day ?? (record?.start_datetime ?? '').toString().slice(0, 10);
          const recordId = record?.id ?? `${day}-${endpoint}`;
          const key = `${endpoint}:${recordId}`;
          rows.push([key, day, endpoint, syncedAt, JSON.stringify(record)]);
        }
      }
      totals[TAB.RAW_JSON] = await this.sheets.upsertRows(id, TAB.RAW_JSON, 0, rows);
    }

    const daysSet = new Set<string>();
    [dailySleep, readiness, activity, resilience].forEach((arr) =>
      arr.forEach((r: any) => r?.day && daysSet.add(r.day))
    );

    return {
      range: { start: startDate, end: endDate },
      totals,
      daysProcessed: Array.from(daysSet).sort(),
    };
  }

  private requireSpreadsheetId(): string {
    const id = this.config.spreadsheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '';
    if (!id) {
      throw new Error(
        'Spreadsheet ID is not configured. Set GOOGLE_SHEETS_SPREADSHEET_ID or sheetsConfig.spreadsheetId.'
      );
    }
    return id;
  }
}

// ---------- Row builders ----------

function buildDailySummaryRows(args: {
  dailySleep: any[]; sleep: any[]; readiness: any[]; activity: any[];
  resilience: any[]; workouts: any[]; syncedAt: string;
}): any[][] {
  const days = new Set<string>();
  args.dailySleep.forEach((r) => r?.day && days.add(r.day));
  args.readiness.forEach((r) => r?.day && days.add(r.day));
  args.activity.forEach((r) => r?.day && days.add(r.day));
  args.resilience.forEach((r) => r?.day && days.add(r.day));

  const sleepByDay = pickLongestSleepByDay(args.sleep);
  const dailySleepByDay = indexByDay(args.dailySleep);
  const readinessByDay = indexByDay(args.readiness);
  const activityByDay = indexByDay(args.activity);
  const resilienceByDay = indexByDay(args.resilience);
  const workoutsByDay = groupBy(args.workouts, (w: any) => w?.day);

  return Array.from(days).sort().map((day) => {
    const ds = dailySleepByDay[day];
    const sl = sleepByDay[day];
    const rd = readinessByDay[day];
    const ac = activityByDay[day];
    const rs = resilienceByDay[day];
    const wo = workoutsByDay[day] ?? [];

    return [
      day,
      weekdayName(day),
      num(ds?.score),
      num(rd?.score),
      num(ac?.score),
      str(rs?.level),
      hours(sl?.total_sleep_duration),
      hours(sl?.deep_sleep_duration),
      hours(sl?.rem_sleep_duration),
      hours(sl?.light_sleep_duration),
      hours(sl?.awake_time),
      num(sl?.efficiency),
      minutes(sl?.latency),
      round1(sl?.average_hrv),
      num(sl?.lowest_heart_rate),
      round1(sl?.average_heart_rate),
      round2(rd?.temperature_deviation),
      round2(rd?.temperature_trend_deviation),
      num(ac?.steps),
      num(ac?.active_calories),
      num(ac?.total_calories),
      num(ac?.equivalent_walking_distance),
      minutes(ac?.high_activity_time),
      minutes(ac?.medium_activity_time),
      minutes(ac?.low_activity_time),
      minutes(ac?.sedentary_time),
      wo.length,
      wo.map((w: any) => `${w.activity}(${Math.round((durationMin(w.start_datetime, w.end_datetime)))}m)`).join('; '),
      str(sl?.bedtime_start),
      str(sl?.bedtime_end),
      args.syncedAt,
    ];
  });
}

function sleepRow(r: any, syncedAt: string): any[] {
  return [
    str(r?.id),
    str(r?.day),
    str(r?.type),
    str(r?.bedtime_start),
    str(r?.bedtime_end),
    hours(r?.total_sleep_duration),
    hours(r?.time_in_bed),
    hours(r?.awake_time),
    hours(r?.deep_sleep_duration),
    hours(r?.rem_sleep_duration),
    hours(r?.light_sleep_duration),
    num(r?.efficiency),
    minutes(r?.latency),
    num(r?.restless_periods),
    round1(r?.average_heart_rate),
    num(r?.lowest_heart_rate),
    round1(r?.average_hrv),
    round1(r?.average_breath),
    syncedAt,
  ];
}

function readinessRow(r: any, syncedAt: string): any[] {
  const c = r?.contributors ?? {};
  return [
    str(r?.day),
    num(r?.score),
    round2(r?.temperature_deviation),
    round2(r?.temperature_trend_deviation),
    num(c.activity_balance),
    num(c.body_temperature),
    num(c.hrv_balance),
    num(c.previous_day_activity),
    num(c.previous_night),
    num(c.recovery_index),
    num(c.resting_heart_rate),
    num(c.sleep_balance),
    syncedAt,
  ];
}

function activityRow(r: any, syncedAt: string): any[] {
  const c = r?.contributors ?? {};
  return [
    str(r?.day),
    num(r?.score),
    num(r?.steps),
    num(r?.active_calories),
    num(r?.total_calories),
    num(r?.target_calories),
    num(r?.equivalent_walking_distance),
    num(r?.meters_to_target),
    minutes(r?.high_activity_time),
    minutes(r?.medium_activity_time),
    minutes(r?.low_activity_time),
    minutes(r?.sedentary_time),
    minutes(r?.resting_time),
    minutes(r?.non_wear_time),
    num(r?.high_activity_met_minutes),
    num(r?.medium_activity_met_minutes),
    num(r?.low_activity_met_minutes),
    num(r?.sedentary_met_minutes),
    num(r?.average_met_minutes),
    num(r?.inactivity_alerts),
    num(c.meet_daily_targets),
    num(c.move_every_hour),
    num(c.recovery_time),
    num(c.stay_active),
    num(c.training_frequency),
    num(c.training_volume),
    syncedAt,
  ];
}

function resilienceRow(r: any, syncedAt: string): any[] {
  const c = r?.contributors ?? {};
  return [
    str(r?.day),
    str(r?.level),
    round2(c.sleep_recovery),
    round2(c.daytime_recovery),
    round2(c.stress),
    syncedAt,
  ];
}

function workoutRow(r: any, syncedAt: string): any[] {
  return [
    str(r?.id),
    str(r?.day),
    str(r?.activity),
    str(r?.intensity),
    str(r?.label),
    str(r?.source),
    str(r?.start_datetime),
    str(r?.end_datetime),
    Math.round(durationMin(r?.start_datetime, r?.end_datetime)),
    num(r?.calories),
    num(r?.distance),
    syncedAt,
  ];
}

// ---------- Helpers ----------

function indexByDay<T extends { day?: string }>(arr: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of arr) if (r?.day) out[r.day] = r;
  return out;
}

function groupBy<T>(arr: T[], keyFn: (t: T) => string | undefined): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of arr) {
    const k = keyFn(r);
    if (!k) continue;
    (out[k] ||= []).push(r);
  }
  return out;
}

function pickLongestSleepByDay(arr: any[]): Record<string, any> {
  const byDay = groupBy(arr, (r: any) => r?.day);
  const out: Record<string, any> = {};
  for (const [day, recs] of Object.entries(byDay)) {
    const longSleep = recs.find((r: any) => r?.type === 'long_sleep');
    if (longSleep) {
      out[day] = longSleep;
      continue;
    }
    out[day] = recs.reduce((a: any, b: any) =>
      (a?.total_sleep_duration ?? 0) >= (b?.total_sleep_duration ?? 0) ? a : b
    );
  }
  return out;
}

function num(v: any): number | string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
}

function str(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function round1(v: any): number | string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Math.round(n * 10) / 10;
}

function round2(v: any): number | string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Math.round(n * 100) / 100;
}

/** Seconds → hours, rounded to 0.01. */
function hours(seconds: any): number | string {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  return Math.round((n / 3600) * 100) / 100;
}

/** Seconds → minutes, rounded to whole. */
function minutes(seconds: any): number | string {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  return Math.round(n / 60);
}

function durationMin(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return (e - s) / 60000;
}

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function weekdayName(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}
