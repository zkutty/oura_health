# Oura API Available Data Types

The Oura API v2 provides access to various health metrics. Here's what's available for today:

## Currently Implemented

### ✅ Daily Aggregated Data
1. **Sleep** (`/usercollection/sleep`)
   - Sleep score (0-100)
   - Total sleep duration
   - Deep sleep duration
   - REM sleep duration
   - Light sleep duration
   - Sleep efficiency
   - Bedtime start/end

2. **Readiness** (`/usercollection/daily_readiness`)
   - Readiness score (0-100)
   - Resting heart rate
   - Heart rate variability (HRV) balance
   - Recovery index
   - Temperature deviation

3. **Activity** (`/usercollection/daily_activity`)
   - Activity score (0-100)
   - Steps
   - Total calories
   - Active calories
   - MET minutes (average, low, medium, high)

### ✅ Real-time/Continuous Data
4. **Heart Rate** (`/usercollection/heartrate`)
   - Continuous heart rate measurements
   - Timestamp for each measurement
   - Source: 'awake', 'rest', 'workout', or 'sleep'
   - Available throughout the day

5. **Workouts** (`/usercollection/workout`)
   - Workout sessions (auto-detected and manual)
   - Activity type
   - Start/end datetime
   - Calories burned
   - Distance
   - Intensity
   - Available for today if workouts occurred

6. **Sessions** (`/usercollection/session`)
   - Guided/unguided sessions (meditation, breathing, etc.)
   - Start/end datetime
   - Session type
   - Heart rate data during session
   - HRV data during session
   - Available for today if sessions were completed

## Additional Available Endpoints (Not Yet Implemented)

### HRV (Heart Rate Variability)
- **Endpoint**: `/usercollection/daily_hrv` or session-level HRV
- **Description**: Daily HRV summaries and session-level HRV data
- **Availability**: Available for today

### Body Temperature
- **Endpoint**: `/usercollection/daily_skin_temperature` or similar
- **Description**: Temperature deviation from baseline
- **Availability**: Included in readiness data, but also available separately

### SpO₂ (Blood Oxygen)
- **Endpoint**: `/usercollection/sleep` (included in sleep data)
- **Description**: Blood oxygen saturation during sleep
- **Availability**: Available with sleep data

### Tags
- **Endpoint**: `/usercollection/tag`
- **Description**: User-created tags for events/conditions
- **Availability**: Available for any date

### Sleep Sessions (Detailed)
- **Endpoint**: `/usercollection/sleep` (already implemented)
- **Description**: Detailed sleep session data with stages
- **Availability**: Available for today (from last night)

## Example: What's Available for Today

When you fetch today's data, you can get:
- ✅ **Readiness score** - Available in the morning
- ✅ **Sleep score** - From last night (available today)
- ✅ **Activity score** - For today (updates throughout the day)
- ✅ **Heart rate data** - Real-time measurements throughout today
- ✅ **Workouts** - Any workouts you've done today
- ✅ **Sessions** - Any meditation/breathing sessions today

## Usage Examples

```typescript
const ouraService = new OuraService();

// Get today's complete summary
const summary = await ouraService.getTodaySummary();

// Access today's data
console.log('Readiness:', summary.readiness?.score);
console.log('Sleep:', summary.sleep?.score);
console.log('Activity:', summary.activity?.score);
console.log('Heart rate measurements:', summary.heartRate?.length);
console.log('Workouts today:', summary.workouts?.length);
console.log('Sessions today:', summary.sessions?.length);
```

## Notes

- **Readiness** is typically available in the morning after you wake up
- **Sleep** data from last night is available today
- **Activity** data updates throughout the day as you move
- **Heart rate** data is continuous throughout the day
- **Workouts** and **Sessions** are available immediately after completion

For more details, see the [Oura API Documentation](https://cloud.ouraring.com/docs/).
