import { OuraDailySummary, OuraSleepData, OuraReadinessData } from '../services/ouraService';

export class DataFreshnessChecker {
  /**
   * Check if sleep data is from last night (fresh)
   * Sleep data is considered fresh if the user woke up within the last 12 hours
   */
  static isSleepDataFresh(sleepData: OuraSleepData): boolean {
    try {
      const bedtimeEnd = new Date(sleepData.bedtime_end);
      const now = new Date();
      const hoursSinceWakeup = (now.getTime() - bedtimeEnd.getTime()) / (1000 * 60 * 60);

      // Consider fresh if woke up within last 12 hours
      return hoursSinceWakeup >= 0 && hoursSinceWakeup <= 12;
    } catch (error) {
      console.error('Error checking sleep data freshness:', error);
      return false;
    }
  }

  /**
   * Check if readiness data is from today
   * Readiness data should match today's date to be considered fresh
   */
  static isReadinessDataFresh(date: string): boolean {
    try {
      const today = new Date().toISOString().split('T')[0];
      return date === today;
    } catch (error) {
      console.error('Error checking readiness data freshness:', error);
      return false;
    }
  }

  /**
   * Check if activity data is from today or yesterday
   * Activity data can be from yesterday since it represents the previous day's activity
   */
  static isActivityDataFresh(date: string): boolean {
    try {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      return date === today || date === yesterdayStr;
    } catch (error) {
      console.error('Error checking activity data freshness:', error);
      return false;
    }
  }

  /**
   * Main method to check if all required data is fresh enough for playlist generation
   * Requires both sleep and readiness data to be fresh
   */
  static isDataFreshForPlaylist(summary: OuraDailySummary): boolean {
    // Must have both sleep and readiness data
    if (!summary.sleep || !summary.readiness) {
      console.log('Missing required data for playlist generation');
      return false;
    }

    const sleepFresh = this.isSleepDataFresh(summary.sleep);
    const readinessFresh = this.isReadinessDataFresh(summary.date);

    console.log(`Data freshness check - Sleep: ${sleepFresh}, Readiness: ${readinessFresh}`);

    return sleepFresh && readinessFresh;
  }

  /**
   * Get a human-readable status message about data freshness
   */
  static getDataFreshnessStatus(summary: OuraDailySummary): string {
    if (!summary.sleep && !summary.readiness) {
      return 'No health data available';
    }

    if (!summary.sleep) {
      return 'Missing sleep data';
    }

    if (!summary.readiness) {
      return 'Missing readiness data';
    }

    const sleepFresh = this.isSleepDataFresh(summary.sleep);
    const readinessFresh = this.isReadinessDataFresh(summary.date);

    if (sleepFresh && readinessFresh) {
      return 'All data is fresh and ready';
    }

    if (!sleepFresh && !readinessFresh) {
      return 'Both sleep and readiness data are stale';
    }

    if (!sleepFresh) {
      return 'Sleep data is stale (wake time is more than 12 hours ago)';
    }

    return 'Readiness data is not from today';
  }

  /**
   * Calculate hours since user woke up (from sleep data)
   */
  static getHoursSinceWakeup(sleepData: OuraSleepData): number {
    try {
      const bedtimeEnd = new Date(sleepData.bedtime_end);
      const now = new Date();
      return (now.getTime() - bedtimeEnd.getTime()) / (1000 * 60 * 60);
    } catch (error) {
      console.error('Error calculating hours since wakeup:', error);
      return -1;
    }
  }
}
