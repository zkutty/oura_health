import axios, { AxiosInstance } from 'axios';

export interface OuraSleepData {
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
  score: number;
  temperature_deviation: number;
  resting_heart_rate: number;
  hrv_balance: number;
  recovery_index: number;
}

export interface OuraActivityData {
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

export interface OuraDailySummary {
  date: string;
  sleep?: OuraSleepData;
  readiness?: OuraReadinessData;
  activity?: OuraActivityData;
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

      const response = await this.client.get('/usercollection/sleep', { params });
      return response.data.data || [];
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

  async getTodaySummary(): Promise<OuraDailySummary> {
    try {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      const [sleepData, readinessData, activityData, heartRateData, workoutData, sessionData] = await Promise.all([
        this.getSleepData(dateStr, dateStr),
        this.getReadinessData(dateStr, dateStr),
        this.getActivityData(dateStr, dateStr),
        this.getHeartRateData(dateStr, dateStr).catch(() => []),
        this.getWorkoutData(dateStr, dateStr).catch(() => []),
        this.getSessionData(dateStr, dateStr).catch(() => []),
      ]);

      return {
        date: dateStr,
        sleep: sleepData[0],
        readiness: readinessData[0],
        activity: activityData[0],
        heartRate: heartRateData,
        workouts: workoutData,
        sessions: sessionData,
      };
    } catch (error: any) {
      console.error('Error fetching today summary:', error.message);
      throw error;
    }
  }

  async getYesterdaySummary(): Promise<OuraDailySummary> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      const [sleepData, readinessData, activityData] = await Promise.all([
        this.getSleepData(dateStr, dateStr),
        this.getReadinessData(dateStr, dateStr),
        this.getActivityData(dateStr, dateStr),
      ]);

      return {
        date: dateStr,
        sleep: sleepData[0],
        readiness: readinessData[0],
        activity: activityData[0],
      };
    } catch (error: any) {
      console.error('Error fetching yesterday summary:', error.message);
      throw error;
    }
  }

  async getLatestSummary(): Promise<OuraDailySummary> {
    try {
      // Get the most recent available data (usually today's or yesterday's)
      const [sleepData, readinessData, activityData] = await Promise.all([
        this.getSleepData(),
        this.getReadinessData(),
        this.getActivityData(),
      ]);

      // Use the most recent date available
      let dateStr = new Date().toISOString().split('T')[0];
      if (readinessData.length > 0 && readinessData[0]) {
        dateStr = readinessData[0].toString().split('T')[0];
      } else if (sleepData.length > 0 && sleepData[0]) {
        dateStr = sleepData[0].toString().split('T')[0];
      }

      return {
        date: dateStr,
        sleep: sleepData[0],
        readiness: readinessData[0],
        activity: activityData[0],
      };
    } catch (error: any) {
      console.error('Error fetching latest summary:', error.message);
      throw error;
    }
  }

  async getLatestSleep(): Promise<OuraSleepData | null> {
    try {
      const sleepData = await this.getSleepData();
      return sleepData.length > 0 ? sleepData[0] : null;
    } catch (error) {
      throw error;
    }
  }

  async getLatestReadiness(): Promise<OuraReadinessData | null> {
    try {
      const readinessData = await this.getReadinessData();
      return readinessData.length > 0 ? readinessData[0] : null;
    } catch (error) {
      throw error;
    }
  }
}
