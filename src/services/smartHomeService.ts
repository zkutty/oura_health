import { OuraDailySummary, OuraSleepData, OuraReadinessData, OuraActivityData } from './ouraService';
import { LightingService } from './lightingService';
import { EnergyLevel } from './playlistService';
import axios from 'axios';

export interface SmartHomeAction {
  id: string;
  name: string;
  device: string;
  action: string;
  actionType?: 'lighting_scene' | 'lighting_energy' | 'generic';
  lightingScene?: string;
  condition: ActionCondition;
}

export interface ActionCondition {
  metric: 'sleep' | 'readiness' | 'activity' | 'combined';
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  threshold: number;
  subMetric?: 'score' | 'duration' | 'efficiency' | 'resting_heart_rate' | 'steps';
}

export interface SmartHomeConfig {
  enabled: boolean;
  actions: SmartHomeAction[];
  alexaEndpoint?: string;
}

export class SmartHomeService {
  private config: SmartHomeConfig;
  private lightingService?: LightingService;

  constructor(lightingService?: LightingService) {
    this.config = {
      enabled: process.env.SMART_HOME_ENABLED === 'true',
      actions: [],
    };
    this.lightingService = lightingService;
  }

  loadConfig(config: SmartHomeConfig): void {
    this.config = config;
  }

  async evaluateAndExecuteActions(summary: OuraDailySummary): Promise<string[]> {
    if (!this.config.enabled || !this.config.actions.length) {
      return [];
    }

    const executedActions: string[] = [];

    for (const action of this.config.actions) {
      const shouldExecute = this.evaluateCondition(summary, action.condition);
      
      if (shouldExecute) {
        try {
          await this.executeAction(action);
          executedActions.push(action.name);
        } catch (error: any) {
          console.error(`Failed to execute action ${action.name}:`, error.message);
        }
      }
    }

    return executedActions;
  }

  private evaluateCondition(
    summary: OuraDailySummary,
    condition: ActionCondition
  ): boolean {
    let value: number | undefined;

    switch (condition.metric) {
      case 'sleep':
        value = this.getSleepMetric(summary.sleep, condition.subMetric || 'score');
        break;
      case 'readiness':
        value = this.getReadinessMetric(summary.readiness, condition.subMetric || 'score');
        break;
      case 'activity':
        value = this.getActivityMetric(summary.activity, condition.subMetric || 'score');
        break;
      case 'combined':
        // Average of sleep, readiness, and activity scores
        const scores = [
          summary.sleep?.score,
          summary.readiness?.score,
          summary.activity?.score,
        ].filter((s): s is number => s !== undefined);
        value = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
        break;
    }

    if (value === undefined) {
      return false;
    }

    switch (condition.operator) {
      case 'lt':
        return value < condition.threshold;
      case 'lte':
        return value <= condition.threshold;
      case 'gt':
        return value > condition.threshold;
      case 'gte':
        return value >= condition.threshold;
      case 'eq':
        return value === condition.threshold;
      default:
        return false;
    }
  }

  private getSleepMetric(sleep: OuraSleepData | undefined, subMetric: string): number | undefined {
    if (!sleep) return undefined;
    
    switch (subMetric) {
      case 'score':
        return sleep.score;
      case 'duration':
        return sleep.total_sleep_duration / 3600; // Convert to hours
      case 'efficiency':
        return sleep.efficiency;
      default:
        return sleep.score;
    }
  }

  private getReadinessMetric(readiness: OuraReadinessData | undefined, subMetric: string): number | undefined {
    if (!readiness) return undefined;
    
    switch (subMetric) {
      case 'score':
        return readiness.score;
      case 'resting_heart_rate':
        return readiness.resting_heart_rate;
      default:
        return readiness.score;
    }
  }

  private getActivityMetric(activity: OuraActivityData | undefined, subMetric: string): number | undefined {
    if (!activity) return undefined;
    
    switch (subMetric) {
      case 'score':
        return activity.score;
      case 'steps':
        return activity.steps;
      default:
        return activity.score;
    }
  }

  private async executeAction(action: SmartHomeAction): Promise<void> {
    console.log(`Executing smart home action: ${action.name}`);
    console.log(`Device: ${action.device}, Action: ${action.action}`);

    // Handle lighting actions if LightingService is available
    if (this.lightingService && action.actionType === 'lighting_scene' && action.lightingScene) {
      try {
        const result = await this.lightingService.applyNamedScene(action.lightingScene);
        if (result.success) {
          console.log(`✓ Applied lighting scene "${action.lightingScene}" to ${result.devicesUpdated} device(s)`);
        } else {
          console.log(`✗ Failed to apply lighting scene: ${result.error}`);
        }
        return;
      } catch (error: any) {
        console.error(`Error applying lighting scene:`, error.message);
      }
    }

    // Handle energy-based lighting actions
    if (this.lightingService && action.actionType === 'lighting_energy') {
      try {
        const energyLevel = this.extractEnergyLevelFromAction(action);
        if (energyLevel) {
          const result = await this.lightingService.applySceneForEnergyLevel(energyLevel);
          if (result.success) {
            console.log(`✓ Applied ${energyLevel} energy lighting to ${result.devicesUpdated} device(s)`);
          }
        }
        return;
      } catch (error: any) {
        console.error(`Error applying energy-based lighting:`, error.message);
      }
    }

    // Fallback to Alexa endpoint or generic action
    if (this.config.alexaEndpoint) {
      try {
        await axios.post(this.config.alexaEndpoint, {
          device: action.device,
          action: action.action,
        });
      } catch (error) {
        console.log(`Would execute: ${action.device} -> ${action.action}`);
      }
    } else {
      console.log(`Would execute: ${action.device} -> ${action.action}`);
    }
  }

  private extractEnergyLevelFromAction(action: SmartHomeAction): EnergyLevel | null {
    // Try to determine energy level from action name or device
    const actionLower = `${action.name} ${action.action}`.toLowerCase();

    if (actionLower.includes('very_low') || actionLower.includes('recovery')) return 'very_low';
    if (actionLower.includes('low')) return 'low';
    if (actionLower.includes('moderate')) return 'moderate';
    if (actionLower.includes('high') && !actionLower.includes('very')) return 'high';
    if (actionLower.includes('very_high') || actionLower.includes('peak')) return 'very_high';

    return null;
  }

  getConfig(): SmartHomeConfig {
    return this.config;
  }

  addAction(action: SmartHomeAction): void {
    this.config.actions.push(action);
  }

  removeAction(actionId: string): void {
    this.config.actions = this.config.actions.filter(a => a.id !== actionId);
  }
}
