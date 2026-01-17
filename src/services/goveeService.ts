import axios, { AxiosInstance } from 'axios';

export interface GoveeDevice {
  device: string;
  model: string;
  deviceName: string;
  controllable: boolean;
  retrievable: boolean;
  supportCmds: string[];
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export class GoveeService {
  private client: AxiosInstance;
  private apiKey: string;
  private devices: GoveeDevice[] | null = null;

  constructor() {
    this.apiKey = process.env.GOVEE_API_KEY || '';

    this.client = axios.create({
      baseURL: 'https://developer-api.govee.com/v1',
      headers: {
        'Govee-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get all Govee devices
   */
  async getDevices(): Promise<GoveeDevice[]> {
    if (this.devices) {
      return this.devices;
    }

    try {
      const response = await this.client.get('/devices');
      this.devices = response.data.data.devices;
      return this.devices as GoveeDevice[];
    } catch (error: any) {
      console.error('Error fetching Govee devices:', error.message);
      throw new Error('Failed to fetch Govee devices');
    }
  }

  /**
   * Turn device on or off
   */
  async setPower(device: GoveeDevice, powerState: boolean): Promise<boolean> {
    try {
      const payload = {
        device: device.device,
        model: device.model,
        cmd: {
          name: 'turn',
          value: powerState ? 'on' : 'off',
        },
      };

      const response = await this.client.put('/devices/control', payload);
      return response.status === 200;
    } catch (error: any) {
      console.error(`Error setting power for ${device.deviceName}:`, error.message);
      return false;
    }
  }

  /**
   * Set brightness (0-100)
   */
  async setBrightness(device: GoveeDevice, brightness: number): Promise<boolean> {
    try {
      const clampedBrightness = Math.max(0, Math.min(100, Math.round(brightness)));

      const payload = {
        device: device.device,
        model: device.model,
        cmd: {
          name: 'brightness',
          value: clampedBrightness,
        },
      };

      const response = await this.client.put('/devices/control', payload);
      return response.status === 200;
    } catch (error: any) {
      console.error(`Error setting brightness for ${device.deviceName}:`, error.message);
      return false;
    }
  }

  /**
   * Set RGB color (r, g, b) where each is 0-255
   */
  async setColor(device: GoveeDevice, rgb: RGBColor | number[]): Promise<boolean> {
    try {
      const color = Array.isArray(rgb) ? { r: rgb[0], g: rgb[1], b: rgb[2] } : rgb;

      const payload = {
        device: device.device,
        model: device.model,
        cmd: {
          name: 'color',
          value: {
            r: Math.round(color.r),
            g: Math.round(color.g),
            b: Math.round(color.b),
          },
        },
      };

      const response = await this.client.put('/devices/control', payload);
      return response.status === 200;
    } catch (error: any) {
      console.error(`Error setting color for ${device.deviceName}:`, error.message);
      return false;
    }
  }

  /**
   * Set color temperature in Kelvin (2000-9000)
   */
  async setColorTemperature(device: GoveeDevice, temperature: number): Promise<boolean> {
    try {
      const clampedTemp = Math.max(2000, Math.min(9000, Math.round(temperature)));

      const payload = {
        device: device.device,
        model: device.model,
        cmd: {
          name: 'colorTem',
          value: clampedTemp,
        },
      };

      const response = await this.client.put('/devices/control', payload);
      return response.status === 200;
    } catch (error: any) {
      console.error(`Error setting color temperature for ${device.deviceName}:`, error.message);
      return false;
    }
  }

  /**
   * Apply a predefined Govee scene
   * Note: Scene codes may vary by device model
   */
  async setScene(device: GoveeDevice, sceneCode: number): Promise<boolean> {
    try {
      const payload = {
        device: device.device,
        model: device.model,
        cmd: {
          name: 'scene',
          value: sceneCode,
        },
      };

      const response = await this.client.put('/devices/control', payload);
      return response.status === 200;
    } catch (error: any) {
      console.error(`Error setting scene for ${device.deviceName}:`, error.message);
      return false;
    }
  }

  /**
   * Turn off all devices
   */
  async turnOffAll(): Promise<void> {
    const devices = await this.getDevices();
    await Promise.all(devices.map(device => this.setPower(device, false)));
  }

  /**
   * Turn on all devices
   */
  async turnOnAll(): Promise<void> {
    const devices = await this.getDevices();
    await Promise.all(devices.map(device => this.setPower(device, true)));
  }
}
