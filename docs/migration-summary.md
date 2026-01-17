# Migration to Option A (Alexa Routines) - Summary

## ✅ What's Been Implemented

### 1. **AlexaRoutineService** (`src/services/alexaRoutineService.ts`)
- Service to trigger Alexa routines programmatically
- Maps energy levels to routine names
- Currently uses placeholder implementation (see note below)

### 2. **Updated LightingService** (`src/services/lightingService.ts`)
- Now supports both `govee` and `alexa` providers
- Automatically detects provider from config
- Falls back gracefully if provider not available

### 3. **Lambda Handler Structure** (`src/lambda/index.ts`)
- Converted Express routes to Lambda handlers
- Scheduled functions for:
  - Morning automation (7 AM)
  - Playlist generation (7:45 AM)
  - Playlist retries (8 AM - 1 PM)
  - Evening wind-down (9 PM)
- Alexa skill handler using Lambda adapter

### 4. **Serverless Configuration** (`serverless.yml`)
- Complete AWS Lambda deployment config
- EventBridge scheduled rules (replaces node-cron)
- Environment variable management
- CloudWatch logging setup

### 5. **Updated Configuration** (`src/config/lightingConfig.json`)
- Added `alexaRoutines` section
- Provider set to `"alexa"`
- Routine name mappings configured

### 6. **Package Updates** (`package.json`)
- Added Serverless Framework dependencies
- Added AWS Lambda types
- New deployment scripts

## ⚠️ Important Note: Routine Triggering API

**Amazon does not provide a direct public API to trigger Alexa routines programmatically.**

The current `AlexaRoutineService.triggerRoutine()` implementation is a **placeholder**. You have three options:

### Option 1: Use Alexa Smart Home API (Recommended)
Extend your skill to include Smart Home capability and control devices directly. This is essentially what Option B does, but you can implement it incrementally.

### Option 2: Custom Intent Workaround
Create a custom intent in your skill that accepts routine names, then call that intent programmatically. More complex but works with existing routines.

### Option 3: Virtual Button/Switch
Create virtual switches in Alexa that trigger routines, then control the switches from Lambda. Simple but requires additional setup.

## 📋 Next Steps

### Immediate:
1. **Install dependencies**: `npm install`
2. **Create Alexa Routines** in Alexa app (see `alexa-routines-setup.md`)
3. **Update routine names** in `lightingConfig.json` to match exactly
4. **Choose routine triggering method** (see above)

### For Deployment:
1. **Build project**: `npm run build`
2. **Configure AWS credentials**: `aws configure`
3. **Set environment variables** in `.env` or AWS Lambda
4. **Deploy**: `npm run deploy`
5. **Update Alexa Skill endpoint** to Lambda ARN

### For Production:
1. **Implement actual routine triggering** (choose one of the 3 options above)
2. **Test all energy level mappings**
3. **Monitor CloudWatch logs**
4. **Set up CloudWatch alarms** for failures

## 🔄 Backward Compatibility

The system maintains backward compatibility:
- If `provider: "govee"` → Uses GoveeService (direct API)
- If `provider: "alexa"` → Uses AlexaRoutineService
- Both can coexist in the codebase

## 📁 Files Changed

### New Files:
- `src/services/alexaRoutineService.ts` - Alexa routine service
- `src/lambda/index.ts` - Lambda handlers
- `serverless.yml` - Serverless Framework config
- `docs/alexa-routines-setup.md` - Setup guide
- `docs/migration-summary.md` - This file

### Modified Files:
- `src/services/lightingService.ts` - Added Alexa provider support
- `src/index.ts` - Updated to support both providers
- `src/config/lightingConfig.json` - Added Alexa routines config
- `package.json` - Added serverless dependencies

## 🧪 Testing

### Local Testing:
```bash
# Run Express server (still works for local dev)
npm run dev

# Test lighting sync
curl -X POST http://localhost:3000/lighting/sync-to-oura
```

### Lambda Testing:
```bash
# Deploy and test
npm run deploy

# View logs
serverless logs -f alexa -t
serverless logs -f morningAutomation -t
```

## 📚 Documentation

- **Setup Guide**: `docs/alexa-routines-setup.md`
- **Architecture**: `docs/deployment-architecture.md`
- **Original Setup**: `docs/setup.md`

## 🎯 Current Status

✅ **Code structure complete** - All services updated  
✅ **Lambda handlers created** - Scheduled functions ready  
✅ **Serverless config ready** - Can deploy to AWS  
⚠️ **Routine triggering** - Needs implementation (placeholder exists)  
⏳ **Routines setup** - User needs to create in Alexa app  
⏳ **Deployment** - Ready but not deployed yet  

## 💡 Recommendations

1. **Start with Option B (Smart Home API)** if you want full programmatic control
2. **Use Option A (Routines)** if you prefer pre-configured scenes in Alexa app
3. **Test locally first** before deploying to Lambda
4. **Monitor CloudWatch logs** after deployment
5. **Set up CloudWatch alarms** for production monitoring

## 🐛 Known Issues

- Routine triggering API not implemented (placeholder only)
- Need to choose and implement one of the 3 workarounds
- Alexa routine names must match exactly (case-sensitive)

## 📞 Support

For questions or issues:
1. Check CloudWatch logs
2. Review `alexa-routines-setup.md`
3. Verify routine names match config
4. Test routines manually in Alexa app
