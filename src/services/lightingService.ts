import { GoveeService, GoveeDevice, RGBColor } from './goveeService';
import { AlexaRoutineService, AlexaRoutineConfig } from './alexaRoutineService';
import { EnergyLevel } from './playlistService';
import { AudioFeatures } from './spotifyService';

export interface LightingScene {
  name: string;
  brightness: number;
  colorTemp?: number;
  color?: number[];
  pulse?: boolean;
  description: string;
  energyLevels?: EnergyLevel[];
  manual?: boolean;
}

export interface LightingConfig {
  enabled: boolean;
  provider: 'govee' | 'alexa';
  scenes: { [key: string]: LightingScene };
  alexaRoutines?: {
    enabled: boolean;
    routineMapping: {
      very_high: string;
      high: string;
      moderate: string;
      low: string;
      very_low: string;
    };
  };
  musicSync: {
    enabled: boolean;
    brightnessRange: { min: number; max: number };
    energyMapping: any;
    valenceToColor: any;
  };
  automation: {
    morningLighting: {
      enabled: boolean;
      time: string;
      basedOnOuraScores: boolean;
    };
    eveningWindDown: {
      enabled: boolean;
      time: string;
      scene: string;
    };
    syncToPlaylist: {
      enabled: boolean;
      updateInterval: number;
      description: string;
    };
  };
}

export interface LightingSyncResult {
  success: boolean;
  devicesUpdated: number;
  sceneName?: string;
  brightness?: number;
  error?: string;
}

export class LightingService {
  private goveeService: GoveeService | null = null;
  private alexaRoutineService: AlexaRoutineService | null = null;
  private config: LightingConfig | null = null;
  private devices: GoveeDevice[] = [];
  private currentSyncInterval: NodeJS.Timeout | null = null;

  constructor(goveeService?: GoveeService, alexaRoutineService?: AlexaRoutineService) {
    this.goveeService = goveeService || null;
    this.alexaRoutineService = alexaRoutineService || null;
  }

  async initialize(): Promise<void> {
    if (!this.config || !this.config.enabled) {
      return;
    }

    // Initialize based on provider
    if (this.config.provider === 'alexa' && this.alexaRoutineService) {
      // Load Alexa routine configuration
      if (this.config.alexaRoutines) {
        const routineConfig: AlexaRoutineConfig = {
          enabled: this.config.alexaRoutines.enabled,
          routineMapping: this.config.alexaRoutines.routineMapping,
        };
        this.alexaRoutineService.loadConfig(routineConfig);
        console.log('Initialized lighting service with Alexa routines');
      }
    } else if (this.config.provider === 'govee' && this.goveeService) {
      try {
        this.devices = await this.goveeService.getDevices();
        console.log(`Initialized lighting service with ${this.devices.length} Govee device(s)`);
      } catch (error: any) {
        console.error('Failed to initialize lighting service:', error.message);
      }
    }
  }

  loadConfig(config: LightingConfig): void {
    this.config = config;
  }

  getConfig(): LightingConfig | null {
    return this.config;
  }

  /**
   * Apply lighting scene based on Oura energy level
   */
  async applySceneForEnergyLevel(energyLevel: EnergyLevel): Promise<LightingSyncResult> {
    if (!this.config || !this.config.enabled) {
      return {
        success: false,
        devicesUpdated: 0,
        error: 'Lighting service not enabled',
      };
    }

    // Use Alexa routines if provider is alexa
    if (this.config.provider === 'alexa' && this.alexaRoutineService && this.config.alexaRoutines?.enabled) {
      const routineName = this.alexaRoutineService.getRoutineNameForEnergyLevel(energyLevel);
      if (!routineName) {
        return {
          success: false,
          devicesUpdated: 0,
          error: `No routine mapping found for energy level: ${energyLevel}`,
        };
      }

      console.log(`Triggering Alexa routine "${routineName}" for energy level ${energyLevel}`);
      const success = await this.alexaRoutineService.triggerRoutine(routineName);

      return {
        success,
        devicesUpdated: success ? 1 : 0, // Routines may control multiple devices
        sceneName: routineName,
      };
    }

    // Fallback to Govee direct control
    if (this.config.provider === 'govee') {
      // Find scene matching this energy level
      let selectedScene: LightingScene | null = null;
      let sceneName = '';

      for (const [name, scene] of Object.entries(this.config.scenes)) {
        if (scene.energyLevels && scene.energyLevels.includes(energyLevel)) {
          selectedScene = scene;
          sceneName = name;
          break;
        }
      }

        if (!selectedScene) {
          return {
            success: false,
            devicesUpdated: 0,
            error: `No scene found for energy level: ${energyLevel}`,
          };
        }

        console.log(`Applying scene "${sceneName}" for energy level ${energyLevel}`);
        return await this.applyScene(selectedScene, sceneName);
    }

    return {
      success: false,
      devicesUpdated: 0,
      error: 'No valid provider configured',
    };
  }

  /**
   * Apply a specific lighting scene to all devices
   */
  async applyScene(scene: LightingScene, sceneName?: string): Promise<LightingSyncResult> {
    if (!this.config || !this.config.enabled) {
      return {
        success: false,
        devicesUpdated: 0,
        error: 'Lighting service not enabled',
      };
    }

    // For Alexa provider, we use routines (handled in applySceneForEnergyLevel)
    // This method is primarily for Govee direct control
    if (this.config.provider === 'govee' && this.goveeService) {
      if (this.devices.length === 0) {
        return {
          success: false,
          devicesUpdated: 0,
          error: 'No devices available',
        };
      }

      try {
        const results = await Promise.allSettled(
          this.devices.map(async (device) => {
            // Turn on device
            await this.goveeService!.setPower(device, true);

            // Set brightness
            await this.goveeService!.setBrightness(device, scene.brightness);

            // Set color or temperature
            if (scene.color && Array.isArray(scene.color)) {
              await this.goveeService!.setColor(device, {
                r: scene.color[0],
                g: scene.color[1],
                b: scene.color[2],
              });
            } else if (scene.colorTemp) {
              await this.goveeService!.setColorTemperature(device, scene.colorTemp);
            }

            return true;
          })
        );

        const successCount = results.filter(r => r.status === 'fulfilled').length;

        return {
          success: successCount > 0,
          devicesUpdated: successCount,
          sceneName: sceneName || scene.name,
          brightness: scene.brightness,
        };
      } catch (error: any) {
        console.error('Error applying lighting scene:', error.message);
        return {
          success: false,
          devicesUpdated: 0,
          error: error.message,
        };
      }
    }

    // For Alexa, try to find a routine name from scene name
    if (this.config.provider === 'alexa' && this.alexaRoutineService) {
      // Try to map scene name to routine (could be enhanced)
      const routineName = sceneName || scene.name;
      const success = await this.alexaRoutineService.triggerRoutine(routineName);
      return {
        success,
        devicesUpdated: success ? 1 : 0,
        sceneName: routineName,
        brightness: scene.brightness,
      };
    }

    return {
      success: false,
      devicesUpdated: 0,
      error: 'No valid provider configured',
    };
  }

  /**
   * Apply named scene from configuration
   */
  async applyNamedScene(sceneName: string): Promise<LightingSyncResult> {
    if (!this.config) {
      return {
        success: false,
        devicesUpdated: 0,
        error: 'No configuration loaded',
      };
    }

    const scene = this.config.scenes[sceneName];
    if (!scene) {
      return {
        success: false,
        devicesUpdated: 0,
        error: `Scene not found: ${sceneName}`,
      };
    }

    return await this.applyScene(scene, sceneName);
  }

  /**
   * Sync lighting to music audio features
   */
  async syncToMusic(audioFeatures: AudioFeatures, energyLevel: EnergyLevel): Promise<LightingSyncResult> {
    if (!this.config || !this.config.enabled || !this.config.musicSync.enabled) {
      return {
        success: false,
        devicesUpdated: 0,
        error: 'Music sync not enabled',
      };
    }

    if (this.devices.length === 0) {
      return {
        success: false,
        devicesUpdated: 0,
        error: 'No devices available',
      };
    }

    try {
      const { energy, valence } = audioFeatures;
      const { brightnessRange, energyMapping, valenceToColor } = this.config.musicSync;

      // Calculate brightness based on track energy
      let brightness = brightnessRange.min + (energy * (brightnessRange.max - brightnessRange.min));

      // Apply energy level boost/reduction
      const levelMapping = energyMapping[energyLevel] || energyMapping.moderate;
      if (levelMapping.brightnessBoost) {
        brightness += levelMapping.brightnessBoost;
      } else if (levelMapping.brightnessReduction) {
        brightness -= levelMapping.brightnessReduction;
      }

      // Clamp brightness
      brightness = Math.max(brightnessRange.min, Math.min(brightnessRange.max, brightness));

      // Determine color based on valence
      let color: RGBColor | null = null;

      if (valence > 0.7) {
        // Happy - yellow-orange
        const hue = valenceToColor.happy.hue;
        const saturation = levelMapping.colorSaturation || 0.6;
        color = this.hsvToRgb(hue, saturation, 1.0);
      } else if (valence < 0.4) {
        // Melancholy - blue
        const hue = valenceToColor.melancholy.hue;
        const saturation = levelMapping.colorSaturation || 0.6;
        color = this.hsvToRgb(hue, saturation, 0.8);
      }
      // Neutral (0.4-0.7) uses color temperature instead of RGB

      // Apply to all devices
      const results = await Promise.allSettled(
        this.devices.map(async (device) => {
          await this.goveeService.setBrightness(device, Math.round(brightness));

          if (color) {
            await this.goveeService.setColor(device, color);
          } else if (valenceToColor.neutral.useColorTemp) {
            await this.goveeService.setColorTemperature(device, valenceToColor.neutral.colorTemp);
          }

          return true;
        })
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;

      console.log(
        `Music sync: brightness=${Math.round(brightness)}, ` +
        `energy=${energy.toFixed(2)}, valence=${valence.toFixed(2)}`
      );

      return {
        success: successCount > 0,
        devicesUpdated: successCount,
        brightness: Math.round(brightness),
      };
    } catch (error: any) {
      console.error('Error syncing to music:', error.message);
      return {
        success: false,
        devicesUpdated: 0,
        error: error.message,
      };
    }
  }

  /**
   * Convert HSV to RGB
   */
  private hsvToRgb(h: number, s: number, v: number): RGBColor {
    let r, g, b;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
      default: r = 0; g = 0; b = 0;
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    };
  }

  /**
   * Turn off all lights
   */
  async turnOffAll(): Promise<LightingSyncResult> {
    if (this.config?.provider === 'govee' && this.goveeService) {
      if (this.devices.length === 0) {
        return {
          success: false,
          devicesUpdated: 0,
          error: 'No devices available',
        };
      }

      try {
        await this.goveeService.turnOffAll();
        return {
          success: true,
          devicesUpdated: this.devices.length,
        };
      } catch (error: any) {
        return {
          success: false,
          devicesUpdated: 0,
          error: error.message,
        };
      }
    }

    // For Alexa, trigger a "Turn Off" routine if configured
    if (this.config?.provider === 'alexa' && this.alexaRoutineService) {
      const success = await this.alexaRoutineService.triggerRoutine('Turn Off Lights');
      return {
        success,
        devicesUpdated: success ? 1 : 0,
      };
    }

    return {
      success: false,
      devicesUpdated: 0,
      error: 'No valid provider configured',
    };
  }

  /**
   * Turn on all lights
   */
  async turnOnAll(): Promise<LightingSyncResult> {
    if (this.config?.provider === 'govee' && this.goveeService) {
      if (this.devices.length === 0) {
        return {
          success: false,
          devicesUpdated: 0,
          error: 'No devices available',
        };
      }

      try {
        await this.goveeService.turnOnAll();
        return {
          success: true,
          devicesUpdated: this.devices.length,
        };
      } catch (error: any) {
        return {
          success: false,
          devicesUpdated: 0,
          error: error.message,
        };
      }
    }

    // For Alexa, trigger a "Turn On" routine if configured
    if (this.config?.provider === 'alexa' && this.alexaRoutineService) {
      const success = await this.alexaRoutineService.triggerRoutine('Turn On Lights');
      return {
        success,
        devicesUpdated: success ? 1 : 0,
      };
    }

    return {
      success: false,
      devicesUpdated: 0,
      error: 'No valid provider configured',
    };
  }

  /**
   * Get list of available scenes
   */
  getAvailableScenes(): string[] {
    if (!this.config) {
      return [];
    }

    return Object.keys(this.config.scenes);
  }
}
