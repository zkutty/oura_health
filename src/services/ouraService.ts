import axios, { AxiosInstance } from 'axios';

export interface OuraSleepData {
  day: string;
  score: number;
  total_sleep_duration: number;
  deep_sleep_duration: number;
  rem_sleep_duration: number;
  light_sleep_duration: number;
  bedtime_start: string;
  bedtime_end: string;
  efficiency: number;
}

export interface OuraReadinessData {
  day: string;
  score: number;
  temperature_deviation: number;
  resting_heart_rate: number;
  hrv_balance: number;
  recovery_index: number;
}

export interface OuraActivityData {
  day: string;
  score: number;
  steps: number;
  calories_total: number;
  active_calories: number;
  average_met_minutes: number;
  low_activity_met_minutes: number;
  medium_activity_met_minutes: number;
  high_activity_met_minutes: number;
}

export interface OuraHeartRateData {
  timestamp: string;
  bpm: number;
  source: 'awake' | 'rest' | 'workout' | 'sleep';
}

export interface OuraWorkoutData {
  id: string;
  activity: string;
  calories: number;
  day: string;
  distance: number;
  end_datetime: string;
  intensity: string;
  label: string;
  source: string;
  start_datetime: string;
}

export interface OuraSessionData {
  id: string;
  day: string;
  start_datetime: string;
  end_datetime: string;
  type: string;
  heart_rate?: {
    interval: number;
    items: number[];
  };
  heart_rate_variability?: {
    interval: number;
    items: number[];
  };
}

export interface OuraResilienceData {
  id: string;
  day: string;
  contributors: {
    sleep_recovery: number;
    daytime_recovery: number;
    stress: number;
  };
  level: 'exceptional' | 'strong' | 'solid' | 'adequate' | 'limited';
}

export interface OuraDailySummary {
  date: string;
  sleep?: OuraSleepData;
  readiness?: OuraReadinessData;
  activity?: OuraActivityData;
  resilience?: OuraResilienceData;
  heartRate?: OuraHeartRateData[];
  workouts?: OuraWorkoutData[];
  sessions?: OuraSessionData[];
}

export class OuraService {
  private client: AxiosInstance;
  private accessToken: string;
  private refreshToken: string;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.accessToken = process.env.OURA_ACCESS_TOKEN || '';
    this.refreshToken = process.env.OURA_REFRESH_TOKEN || '';
    this.clientId = process.env.OURA_CLIENT_ID || '';
    this.clientSecret = process.env.OURA_CLIENT_SECRET || '';

    this.client = axios.create({
      baseURL: 'https://api.ouraring.com/v2',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor to handle token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401 && this.refreshToken) {
          try {
            await this.refreshAccessToken();
            // Retry the original request
            error.config.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.client.request(error.config);
          } catch (refreshError) {
            throw refreshError;
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const response = await axios.post('https://api.ouraring.com/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      this.accessToken = response.data.access_token;
      if (response.data.refresh_token) {
        this.refreshToken = response.data.refresh_token;
      }

      // Update the default authorization header
      this.client.defaults.headers.Authorization = `Bearer ${this.accessToken}`;
    } catch (error) {
      throw new Error('Failed to refresh Oura access token');
    }
  }

  async getSleepData(startDate?: string, endDate?: string): Promise<OuraSleepData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      console.log(`[OuraService] Fetching sleep data with params:`, params);
      const response = await this.client.get('/usercollection/sleep', { params });
      const data = response.data.data || [];
      console.log(`[OuraService] Sleep API returned ${data.length} records`);

      // Log the actual data structure to understand the date field
      if (data.length > 0) {
        console.log(`[OuraService] Sample sleep record:`, JSON.stringify(data[0], null, 2));
      }

      return data;
    } catch (error: any) {
      console.error('Error fetching sleep data:', error.message);
      throw new Error('Failed to fetch sleep data from Oura');
    }
  }

  async getReadinessData(startDate?: string, endDate?: string): Promise<OuraReadinessData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await this.client.get('/usercollection/daily_readiness', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching readiness data:', error.message);
      throw new Error('Failed to fetch readiness data from Oura');
    }
  }

  async getActivityData(startDate?: string, endDate?: string): Promise<OuraActivityData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await this.client.get('/usercollection/daily_activity', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching activity data:', error.message);
      throw new Error('Failed to fetch activity data from Oura');
    }
  }

  async getHeartRateData(startDate?: string, endDate?: string): Promise<OuraHeartRateData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await this.client.get('/usercollection/heartrate', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching heart rate data:', error.message);
      throw new Error('Failed to fetch heart rate data from Oura');
    }
  }

  async getWorkoutData(startDate?: string, endDate?: string): Promise<OuraWorkoutData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await this.client.get('/usercollection/workout', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching workout data:', error.message);
      throw new Error('Failed to fetch workout data from Oura');
    }
  }

  async getSessionData(startDate?: string, endDate?: string): Promise<OuraSessionData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await this.client.get('/usercollection/session', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching session data:', error.message);
      throw new Error('Failed to fetch session data from Oura');
    }
  }

  /**
   * Fetches daily_sleep records (one per day with a sleep score and contributors).
   * Distinct from `/usercollection/sleep`, which returns granular per-period
   * records (long_sleep, naps) and has no top-level score.
   */
  async getDailySleepData(startDate?: string, endDate?: string): Promise<any[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const response = await this.client.get('/usercollection/daily_sleep', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching daily sleep data:', error.message);
      throw new Error('Failed to fetch daily sleep data from Oura');
    }
  }

  /**
   * Generic Oura collection fetch. Returns the raw `data` array for any
   * `/usercollection/*` endpoint, used by the sheets exporter to capture
   * raw JSON for endpoints we don't model with typed methods.
   */
  async fetchCollection(collection: string, startDate?: string, endDate?: string): Promise<any[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const response = await this.client.get(`/usercollection/${collection}`, { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error(`Error fetching ${collection} data:`, error.message);
      throw new Error(`Failed to fetch ${collection} data from Oura`);
    }
  }

  async getResilienceData(startDate?: string, endDate?: string): Promise<OuraResilienceData[]> {
    try {
      const params: any = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;

      const response = await this.client.get('/usercollection/daily_resilience', { params });
      return response.data.data || [];
    } catch (error: any) {
      console.error('Error fetching resilience data:', error.message);
      throw new Error('Failed to fetch resilience data from Oura');
    }
  }

  async getTodaySummary(): Promise<OuraDailySummary> {
    try {
      console.log(`[OuraService] Fetching latest health data (searching last 7 days)...`);

      // Fetch last 7 days of data in one call (more reliable than single-date queries)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      // Only fetch the essential metrics: sleep, readiness, activity, resilience
      const [sleepData, readinessData, activityData, resilienceData] = await Promise.all([
        this.getSleepData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Sleep data fetch failed:', err.message);
          return [];
        }),
        this.getReadinessData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Readiness data fetch failed:', err.message);
          return [];
        }),
        this.getActivityData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Activity data fetch failed:', err.message);
          return [];
        }),
        this.getResilienceData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Resilience data fetch failed:', err.message);
          return [];
        }),
      ]);

      const latestSleep = this.getLatestRecord(sleepData);
      const latestReadiness = this.getLatestRecord(readinessData);
      const latestActivity = this.getLatestRecord(activityData);
      const latestResilience = this.getLatestRecord(resilienceData);

      // Readiness represents the current recovery day. Prefer it so all exported
      // metrics can be selected for one stable calendar date.
      const resultDate = latestReadiness?.day
        ?? latestSleep?.day
        ?? latestActivity?.day
        ?? latestResilience?.day
        ?? endStr;

      console.log(`[OuraService] ✓ Latest data from ${resultDate} - Sleep: ${sleepData.length}, Readiness: ${readinessData.length}, Activity: ${activityData.length} total records`);

      if (!latestSleep && !latestReadiness) {
        console.warn('[OuraService] No sleep or readiness data found in the last 7 days');
      }

      return {
        date: resultDate,
        sleep: this.getRecordForDay(sleepData, resultDate),
        readiness: this.getRecordForDay(readinessData, resultDate),
        activity: this.getRecordForDay(activityData, resultDate),
        resilience: this.getRecordForDay(resilienceData, resultDate),
      };
    } catch (error: any) {
      console.error('Error fetching today summary:', error.message);
      throw error;
    }
  }

  async getSummaryForDate(date: string): Promise<OuraDailySummary> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Date must use YYYY-MM-DD format.');
    }

    // Oura's date filtering is more reliable over a small range than a
    // single-day request. Select the requested day's records after fetching.
    const end = new Date(`${date}T12:00:00.000Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);
    const startDate = start.toISOString().split('T')[0];

    const [sleepData, readinessData, activityData, resilienceData] = await Promise.all([
      this.getSleepData(startDate, date),
      this.getReadinessData(startDate, date),
      this.getActivityData(startDate, date),
      this.getResilienceData(startDate, date),
    ]);

    return {
      date,
      sleep: this.getRecordForDay(sleepData, date),
      readiness: this.getRecordForDay(readinessData, date),
      activity: this.getRecordForDay(activityData, date),
      resilience: this.getRecordForDay(resilienceData, date),
    };
  }

  async getYesterdaySummary(): Promise<OuraDailySummary> {
    try {
      // Use date range query since single-date queries don't work with Oura API
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const targetDate = yesterday.toISOString().split('T')[0];

      // Fetch last 7 days to ensure we get data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const [sleepData, readinessData, activityData] = await Promise.all([
        this.getSleepData(startStr, endStr),
        this.getReadinessData(startStr, endStr),
        this.getActivityData(startStr, endStr),
      ]);

      // Filter for yesterday's data, or use most recent if yesterday not available
      const yesterdaySleep = sleepData.find((s: any) => s.day === targetDate) || sleepData[sleepData.length - 1];
      const yesterdayReadiness = readinessData.find((r: any) => r.day === targetDate) || readinessData[readinessData.length - 1];
      const yesterdayActivity = activityData.find((a: any) => a.day === targetDate) || activityData[activityData.length - 1];

      return {
        date: targetDate,
        sleep: yesterdaySleep,
        readiness: yesterdayReadiness,
        activity: yesterdayActivity,
      };
    } catch (error: any) {
      console.error('Error fetching yesterday summary:', error.message);
      throw error;
    }
  }

  async getLatestSummary(): Promise<OuraDailySummary> {
    return this.getTodaySummary();
  }

  async getLatestSleep(): Promise<OuraSleepData | null> {
    try {
      const sleepData = await this.getSleepData();
      return this.getLatestRecord(sleepData) ?? null;
    } catch (error) {
      throw error;
    }
  }

  async getLatestReadiness(): Promise<OuraReadinessData | null> {
    try {
      const readinessData = await this.getReadinessData();
      return this.getLatestRecord(readinessData) ?? null;
    } catch (error) {
      throw error;
    }
  }

  async getSevenDayTrends(): Promise<{
    sleep: { current: number; average: number; trend: 'rising' | 'falling' | 'stable' };
    readiness: { current: number; average: number; trend: 'rising' | 'falling' | 'stable' };
    activity: { current: number; average: number; trend: 'rising' | 'falling' | 'stable' };
  }> {
    try {
      // Fetch last 7 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      console.log(`[OuraService] Fetching trends data from ${startStr} to ${endStr}`);

      const [sleepData, readinessData, activityData] = await Promise.all([
        this.getSleepData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Sleep data fetch failed in trends:', err.message);
          return [];
        }),
        this.getReadinessData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Readiness data fetch failed in trends:', err.message);
          return [];
        }),
        this.getActivityData(startStr, endStr).catch((err) => {
          console.error('[OuraService] Activity data fetch failed in trends:', err.message);
          return [];
        }),
      ]);

      console.log(`[OuraService] Trends data fetched - Sleep: ${sleepData.length}, Readiness: ${readinessData.length}, Activity: ${activityData.length}`);

      // Extract scores - handle different possible structures
      // Sleep score might be at s.score or nested differently
      const sleepScores = sleepData
        .map((s: any) => {
          // Try multiple possible locations for sleep score
          if (s.score != null && typeof s.score === 'number') return s.score;
          if (s.contributors?.sleep_score != null) return s.contributors.sleep_score;
          if (s.sleep_score != null) return s.sleep_score;
          // Log if we can't find the score
          console.warn('[OuraService] Sleep record missing score:', JSON.stringify(s).substring(0, 200));
          return null;
        })
        .filter((s: number | null): s is number => s != null && typeof s === 'number');

      const readinessScores = readinessData
        .map((r: any) => r.score)
        .filter((s: number | null | undefined): s is number => s != null && typeof s === 'number');

      const activityScores = activityData
        .map((a: any) => a.score)
        .filter((s: number | null | undefined): s is number => s != null && typeof s === 'number');

      console.log(`[OuraService] Extracted scores - Sleep: ${sleepScores.length}, Readiness: ${readinessScores.length}, Activity: ${activityScores.length}`);

      if (sleepScores.length === 0 && sleepData.length > 0) {
        console.warn('[OuraService] Sleep data exists but no scores extracted. Sample record:', JSON.stringify(sleepData[0], null, 2));
      }

      const sleepAvg = sleepScores.length > 0 ? sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length : 0;
      const readinessAvg = readinessScores.length > 0 ? readinessScores.reduce((a, b) => a + b, 0) / readinessScores.length : 0;
      const activityAvg = activityScores.length > 0 ? activityScores.reduce((a, b) => a + b, 0) / activityScores.length : 0;

      // Get current (latest) values
      const currentSleep = sleepScores[sleepScores.length - 1] || 0;
      const currentReadiness = readinessScores[readinessScores.length - 1] || 0;
      const currentActivity = activityScores[activityScores.length - 1] || 0;

      console.log(`[OuraService] Trend calculations - Sleep: current=${currentSleep}, avg=${sleepAvg.toFixed(1)}`);

      // Determine trends
      const getTrend = (current: number, avg: number): 'rising' | 'falling' | 'stable' => {
        const diff = current - avg;
        if (Math.abs(diff) < 3) return 'stable';
        return diff > 0 ? 'rising' : 'falling';
      };

      return {
        sleep: { current: Math.round(currentSleep), average: Math.round(sleepAvg), trend: getTrend(currentSleep, sleepAvg) },
        readiness: { current: Math.round(currentReadiness), average: Math.round(readinessAvg), trend: getTrend(currentReadiness, readinessAvg) },
        activity: { current: Math.round(currentActivity), average: Math.round(activityAvg), trend: getTrend(currentActivity, activityAvg) },
      };
    } catch (error: any) {
      console.error('[OuraService] Error calculating trends:', error.message);
      console.error('[OuraService] Error stack:', error.stack);
      throw error;
    }
  }

  private getLatestRecord<T extends { day: string }>(records: T[]): T | undefined {
    return [...records].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
  }

  private getRecordForDay<T extends { day: string }>(records: T[], date: string): T | undefined {
    return records.find((record) => record.day === date);
  }
}
