/**
 * Example usage of the Oura Health services
 * This file demonstrates how to use the services programmatically
 */

import { OuraService } from '../services/ouraService';
import { SmartHomeService, SmartHomeAction } from '../services/smartHomeService';

// Example: Get yesterday's health summary
export async function getHealthSummary() {
  const ouraService = new OuraService();
  
  try {
    const summary = await ouraService.getYesterdaySummary();
    console.log('Health Summary:', {
      date: summary.date,
      sleepScore: summary.sleep?.score,
      readinessScore: summary.readiness?.score,
      activityScore: summary.activity?.score,
    });
    return summary;
  } catch (error) {
    console.error('Error fetching health summary:', error);
    throw error;
  }
}

// Example: Add a custom smart home action
export function addCustomSmartHomeAction() {
  const smartHomeService = new SmartHomeService();
  
  const action: SmartHomeAction = {
    id: 'example-action',
    name: 'Example: Dim lights on poor sleep',
    device: 'bedroom_lights',
    action: 'dim_to_20_percent',
    condition: {
      metric: 'sleep',
      operator: 'lt',
      threshold: 65,
      subMetric: 'score',
    },
  };
  
  smartHomeService.addAction(action);
  console.log('Added custom action:', action.name);
}

// Example: Evaluate and trigger actions
export async function evaluateAndTriggerActions() {
  const ouraService = new OuraService();
  const smartHomeService = new SmartHomeService();
  
  // Load configuration
  // (In real usage, load from config file or database)
  
  try {
    const summary = await ouraService.getYesterdaySummary();
    const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);
    
    if (executedActions.length > 0) {
      console.log('Executed actions:', executedActions);
    } else {
      console.log('No actions were triggered');
    }
  } catch (error) {
    console.error('Error evaluating actions:', error);
  }
}

// Example: Get specific health metrics
export async function getSleepMetrics() {
  const ouraService = new OuraService();
  
  try {
    const sleep = await ouraService.getLatestSleep();
    if (sleep) {
      console.log('Sleep Metrics:', {
        score: sleep.score,
        totalDuration: `${Math.floor(sleep.total_sleep_duration / 3600)}h ${Math.floor((sleep.total_sleep_duration % 3600) / 60)}m`,
        deepSleep: `${Math.floor(sleep.deep_sleep_duration / 3600)}h`,
        remSleep: `${Math.floor(sleep.rem_sleep_duration / 3600)}h`,
        efficiency: sleep.efficiency,
      });
    }
  } catch (error) {
    console.error('Error fetching sleep metrics:', error);
  }
}
