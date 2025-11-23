import express from 'express';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { skillBuilder } from './handlers/alexaHandlers';
import { OuraService } from './services/ouraService';
import { SmartHomeService } from './services/smartHomeService';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const ouraService = new OuraService();
const smartHomeService = new SmartHomeService();

// Load smart home configuration
try {
  const configPath = path.join(__dirname, 'config', 'smartHomeConfig.json');
  const configData = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configData);
  smartHomeService.loadConfig(config);
  console.log('Smart home configuration loaded');
} catch (error) {
  console.error('Failed to load smart home configuration:', error);
}

// Middleware
app.use(express.json());

// Alexa Skill endpoint
const adapter = new ExpressAdapter(skillBuilder, false, false);
app.post('/alexa', adapter.getRequestHandlers());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manual trigger endpoint for testing smart home actions
app.post('/trigger-smart-home', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);
    
    res.json({
      success: true,
      executedActions,
      summary: {
        date: summary.date,
        sleep: summary.sleep?.score,
        readiness: summary.readiness?.score,
        activity: summary.activity?.score,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Endpoint to get today's health summary
app.get('/health-summary', async (req, res) => {
  try {
    const summary = await ouraService.getTodaySummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Endpoint to manage smart home actions
app.get('/smart-home/config', (req, res) => {
  res.json(smartHomeService.getConfig());
});

app.post('/smart-home/action', (req, res) => {
  try {
    const action = req.body;
    smartHomeService.addAction(action);
    res.json({ success: true, message: 'Action added' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/smart-home/action/:id', (req, res) => {
  try {
    smartHomeService.removeAction(req.params.id);
    res.json({ success: true, message: 'Action removed' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Scheduled job to check health scores and trigger actions
// Runs every morning at 7 AM
cron.schedule('0 7 * * *', async () => {
  console.log('Running scheduled health check and smart home action evaluation...');
  try {
    const summary = await ouraService.getTodaySummary();
    const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);
    
    if (executedActions.length > 0) {
      console.log(`Executed ${executedActions.length} smart home actions:`, executedActions);
    } else {
      console.log('No smart home actions were triggered based on current health scores.');
    }
  } catch (error: any) {
    console.error('Error in scheduled health check:', error.message);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Oura Health Alexa Skill server running on port ${PORT}`);
  console.log(`Alexa endpoint: http://localhost:${PORT}/alexa`);
  console.log(`Smart home automation: ${smartHomeService.getConfig().enabled ? 'enabled' : 'disabled'}`);
});
