# Deployment Architecture: Current vs Recommended

## Current Deployment State

### Architecture
```
┌──────────────────────────────────────────┐
│  Node.js Express Server (Port 3000)      │
│  ├─ Oura API calls                       │
│  ├─ Spotify API calls                    │
│  ├─ Govee API calls (DIRECT)             │
│  ├─ node-cron scheduled tasks            │
│  └─ Alexa Skill endpoints                │
└──────────────────────────────────────────┘
         │
         ├─ Direct HTTP → Govee Cloud API
         ├─ HTTP → Spotify Web API  
         └─ HTTP → Oura API
```

### Current Deployment Options (from docs/setup.md)

**Option 1: AWS Lambda (Mentioned but not configured)**
- Requires serverless framework or SAM
- Needs to handle scheduled tasks (EventBridge instead of node-cron)
- Direct Govee API calls from Lambda

**Option 2: VPS**
- Requires PM2 for process management
- `node-cron` runs scheduled tasks
- Needs SSL certificate (Let's Encrypt)
- Direct Govee API calls

**Option 3: Docker (Mentioned but no Dockerfile)**
- Container service deployment
- Direct Govee API calls

### Current Lighting Control Flow

```
Morning Automation (7 AM cron) 
  → Fetch Oura data
  → Calculate energy level
  → lightingService.applySceneForEnergyLevel()
    → goveeService.setBrightness()
    → goveeService.setColorTemperature()
      → HTTP PUT to https://developer-api.govee.com/v1/devices/control
```

**Challenges:**
- Requires Govee API key (approval process, rate limits)
- Lambda must make external HTTP calls to Govee cloud
- VPS needs to be running 24/7 for cron jobs
- No local network access (must go through Govee cloud)

---

## Recommended Architecture: Alexa Smart Home Integration

### The Game-Changer

**Alexa Skills can run in the cloud (AWS Lambda) and control your local lights because Amazon handles the bridge between cloud and home network through your Echo devices.**

### New Architecture Flow

```
┌──────────────────────────────────────────┐
│  AWS Lambda Function (single deployment) │
│  ├─ Fetch Oura data (EventBridge 6 AM)   │
│  ├─ Generate Spotify playlist            │
│  ├─ Calculate lighting scene             │
│  └─ Call Alexa Smart Home API            │
└──────────────────────────────────────────┘
         │
         ↓ Alexa Smart Home API
┌──────────────────────────────────────────┐
│  Your Echo Device (local network bridge) │
│  └─ Executes commands on local network   │
└──────────────────────────────────────────┘
         │
         ↓ Local network (no cloud!)
┌──────────────────────────────────────────┐
│  Govee Lights (already paired with Alexa)│
└──────────────────────────────────────────┘
```

### Benefits

✅ **No Govee API key needed** - Alexa already controls your lights  
✅ **Local network control** - Faster, more reliable (no cloud latency)  
✅ **Simpler deployment** - One Lambda function, no server management  
✅ **Native integration** - Uses Alexa's existing device control  
✅ **EventBridge scheduling** - Native AWS scheduling (no cron needed)

---

## Implementation Approaches

### Option A: Alexa Routines (Easiest) ✅ Recommended

**Setup:**
1. Create Alexa Routines in the Alexa app (one-time setup):
   - "High Energy Scene" → Bright, cool lights
   - "Moderate Energy Scene" → Neutral lights  
   - "Low Energy Scene" → Dim, warm lights
   - "Very Low Energy Scene" → Recovery mode
   - "Music Sync High" → Bright, saturated
   - "Music Sync Low" → Dim, muted

2. Trigger routines from Lambda using Alexa Skill API or Routine API

**Implementation:**
- Use `ask-sdk` to create a simple routine trigger skill
- Or use Alexa Routines API (if available) to trigger by name
- Lambda determines energy level → triggers corresponding routine

**Pros:**
- ✅ Simplest implementation
- ✅ No device control logic needed
- ✅ Scenes configured once in Alexa app
- ✅ Easy to test and modify scenes

**Cons:**
- ⚠️ Limited programmatic control (routines must be pre-configured)
- ⚠️ Routine triggering may require Skill API integration

### Option B: Custom Alexa Smart Home Skill (More Control)

**Setup:**
1. Register skill as "Smart Home" type (not just "Custom")
2. Implement Smart Home directive handlers
3. Control devices through Alexa's device control API

**Implementation:**
- Handle `Alexa.BrightnessController` directives
- Handle `Alexa.ColorTemperatureController` directives  
- Lambda calculates scene → returns device control directive
- Alexa executes directive on local network

**Pros:**
- ✅ Full programmatic control (brightness, color, temperature)
- ✅ Dynamic scene generation from Lambda
- ✅ No pre-configured routines needed
- ✅ Can control individual devices

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Requires Smart Home skill certification
- ⚠️ Must handle device discovery

---

## Migration Plan

### Phase 1: Lambda Function Setup

1. **Create Lambda handler function**
   - Move Express routes to Lambda handlers
   - Replace `node-cron` with EventBridge scheduled rules
   - Keep existing Oura/Spotify service logic

2. **Configure EventBridge Rules**
   - 7:00 AM - Morning automation
   - 7:45 AM - Playlist generation (with retries)
   - 9:00 PM - Evening wind-down

3. **Deploy infrastructure**
   - Serverless Framework or AWS SAM
   - Environment variables (Oura, Spotify tokens)
   - API Gateway for Alexa Skill endpoint

### Phase 2: Replace Govee Direct API with Alexa Control

#### If Using Option A (Routines):

1. **Create Alexa Routine Trigger Service**
   ```typescript
   // src/services/alexaRoutineService.ts
   export class AlexaRoutineService {
     async triggerRoutine(routineName: string): Promise<boolean> {
       // Use Alexa Skills API or Routine API
       // Returns true if routine triggered successfully
     }
   }
   ```

2. **Update LightingService**
   - Replace `goveeService` calls with `alexaRoutineService.triggerRoutine()`
   - Map energy levels to routine names:
     - `very_high` → "High Energy Scene"
     - `high` → "High Energy Scene"  
     - `moderate` → "Moderate Energy Scene"
     - `low` → "Low Energy Scene"
     - `very_low` → "Very Low Energy Scene"

#### If Using Option B (Smart Home Skill):

1. **Extend Alexa Skill to Smart Home**
   - Add Smart Home capability to skill manifest
   - Implement device discovery endpoint
   - Implement directive handlers for brightness/color

2. **Update LightingService**
   - Replace Govee API calls with Alexa Smart Home directives
   - Return directive responses instead of HTTP calls

### Phase 3: Testing & Deployment

1. **Local testing**
   - Test Lambda function locally (SAM CLI or serverless-offline)
   - Test Alexa Skill with Alexa Simulator

2. **Deploy to AWS**
   - Deploy Lambda function
   - Configure EventBridge rules
   - Update Alexa Skill endpoint to Lambda ARN

3. **Verify automation**
   - Check CloudWatch logs at scheduled times
   - Verify routines/devices are triggered correctly

---

## Code Changes Required

### 1. Create Lambda Handler

**New file: `src/lambda/index.ts`**
```typescript
import { APIGatewayProxyHandler, ScheduledEvent } from 'aws-lambda';
import { OuraService } from '../services/ouraService';
import { PlaylistService } from '../services/playlistService';
// ... other imports

export const alexaHandler: APIGatewayProxyHandler = async (event) => {
  // Existing Alexa skill handler logic
  // Convert from Express to Lambda format
};

export const scheduledMorningAutomation = async (event: ScheduledEvent) => {
  // Morning automation logic (previously cron job)
};

export const scheduledPlaylistGeneration = async (event: ScheduledEvent) => {
  // Playlist generation logic (previously cron job)
};
```

### 2. Create Alexa Routine Service (Option A)

**New file: `src/services/alexaRoutineService.ts`**
```typescript
import axios from 'axios';

export class AlexaRoutineService {
  private skillId: string;
  private accessToken: string;

  async triggerRoutine(routineName: string): Promise<boolean> {
    // Implementation depends on Alexa API availability
    // May need to use Skill API or find routine ID
    // This is a placeholder - actual API may vary
  }
}
```

### 3. Update Lighting Service

**Modify: `src/services/lightingService.ts`**
```typescript
// Replace GoveeService with AlexaRoutineService
import { AlexaRoutineService } from './alexaRoutineService';

export class LightingService {
  private alexaRoutineService: AlexaRoutineService; // instead of goveeService

  async applySceneForEnergyLevel(energyLevel: EnergyLevel): Promise<LightingSyncResult> {
    // Map energy level to routine name
    const routineName = this.mapEnergyLevelToRoutine(energyLevel);
    
    // Trigger routine instead of direct API call
    const success = await this.alexaRoutineService.triggerRoutine(routineName);
    
    return {
      success,
      devicesUpdated: success ? 1 : 0, // Routines may control multiple devices
      sceneName: routineName,
    };
  }

  private mapEnergyLevelToRoutine(level: EnergyLevel): string {
    const mapping = {
      'very_high': 'High Energy Scene',
      'high': 'High Energy Scene',
      'moderate': 'Moderate Energy Scene',
      'low': 'Low Energy Scene',
      'very_low': 'Very Low Energy Scene',
    };
    return mapping[level];
  }
}
```

### 4. Serverless Configuration

**New file: `serverless.yml`**
```yaml
service: oura-health

provider:
  name: aws
  runtime: nodejs18.x
  region: us-east-1
  environment:
    OURA_ACCESS_TOKEN: ${env:OURA_ACCESS_TOKEN}
    SPOTIFY_CLIENT_ID: ${env:SPOTIFY_CLIENT_ID}
    SPOTIFY_CLIENT_SECRET: ${env:SPOTIFY_CLIENT_SECRET}
    # ... other env vars

functions:
  alexa:
    handler: dist/lambda/index.alexaHandler
    events:
      - http:
          path: /alexa
          method: post
          cors: true

  morningAutomation:
    handler: dist/lambda/index.scheduledMorningAutomation
    events:
      - schedule:
          rate: cron(0 7 * * ? *)  # 7 AM daily
          enabled: true

  playlistGeneration:
    handler: dist/lambda/index.scheduledPlaylistGeneration
    events:
      - schedule:
          rate: cron(45 7 * * ? *)  # 7:45 AM daily
          enabled: true
```

---

## Comparison Matrix

| Aspect | Current (Direct Govee API) | Recommended (Alexa Smart Home) |
|--------|---------------------------|--------------------------------|
| **Deployment** | VPS/Lambda (complex) | Lambda only (simple) |
| **API Keys** | Requires Govee API key | No extra API key needed |
| **Network** | Cloud → Govee Cloud → Device | Cloud → Echo → Local Device |
| **Latency** | Higher (cloud roundtrip) | Lower (local network) |
| **Reliability** | Depends on Govee cloud | Uses Alexa's proven infrastructure |
| **Scheduling** | node-cron (requires always-on) | EventBridge (serverless) |
| **Complexity** | Medium (multiple services) | Lower (single Lambda) |
| **Cost** | VPS costs or Lambda cold starts | Lambda only (pay per use) |

---

## Next Steps

1. **Choose approach**: Option A (Routines) or Option B (Smart Home Skill)
2. **Create Lambda handler structure** (Phase 1)
3. **Implement Alexa integration** (Phase 2)
4. **Set up Serverless Framework** for deployment
5. **Test locally** before deploying
6. **Deploy to AWS** and verify automation works

---

## Additional Resources

- [AWS Lambda Alexa Skills Kit Documentation](https://developer.amazon.com/en-US/docs/alexa/ask-overviews/what-is-the-alexa-skills-kit.html)
- [Alexa Smart Home Skills API](https://developer.amazon.com/en-US/docs/alexa/smarthome/understand-the-smarthome-skill-api.html)
- [EventBridge Scheduled Rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html)
- [Serverless Framework](https://www.serverless.com/framework/docs)

---

## Notes

- **Govee devices must already be paired with Alexa** for this approach to work
- Alexa Routines API may have limitations - check current API availability
- Smart Home skill certification may take 1-2 weeks if going with Option B
- Option A (Routines) is recommended for fastest implementation
