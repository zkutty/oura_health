import {
  HandlerInput,
  RequestHandler,
  SkillBuilders,
  getRequestType,
  getIntentName,
} from 'ask-sdk-core';
import { Response } from 'ask-sdk-model';
import { OuraService } from '../services/ouraService';
import { SmartHomeService } from '../services/smartHomeService';

const LaunchRequestHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput: HandlerInput): Response {
    const speakOutput = 'Welcome to Oura Health. You can ask me about your sleep, readiness, or activity scores. What would you like to know?';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(speakOutput)
      .getResponse();
  },
};

const SleepScoreIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && getIntentName(handlerInput.requestEnvelope) === 'SleepScoreIntent';
  },
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const ouraService = new OuraService();

    try {
      const summary = await ouraService.getYesterdaySummary();

      if (summary.sleep) {
        const sleep = summary.sleep as any;
        const hours = Math.floor(sleep.total_sleep_duration / 3600);
        const minutes = Math.floor((sleep.total_sleep_duration % 3600) / 60);

        // Sleep score is nested in sleep.readiness.score in Oura API v2
        const sleepScore = sleep.readiness?.score || 'unavailable';

        // Format the date nicely
        const date = new Date(summary.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

        const speakOutput = `For ${dayName} night, your sleep score was ${sleepScore} out of 100. ` +
          `You slept for ${hours} hours and ${minutes} minutes, with a sleep efficiency of ${sleep.efficiency.toFixed(1)} percent. ` +
          `Your deep sleep was ${Math.floor(sleep.deep_sleep_duration / 3600)} hours and ` +
          `your REM sleep was ${Math.floor(sleep.rem_sleep_duration / 3600)} hours.`;

        return handlerInput.responseBuilder
          .speak(speakOutput)
          .getResponse();
      } else {
        return handlerInput.responseBuilder
          .speak("I couldn't find your sleep data. Please try again later.")
          .getResponse();
      }
    } catch (error: any) {
      console.error('Error fetching sleep score:', error);
      return handlerInput.responseBuilder
        .speak("Sorry, I had trouble getting your sleep data. Please try again later.")
        .getResponse();
    }
  },
};

const ReadinessScoreIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && getIntentName(handlerInput.requestEnvelope) === 'ReadinessScoreIntent';
  },
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const ouraService = new OuraService();

    try {
      const summary = await ouraService.getTodaySummary();

      if (summary.readiness) {
        const readiness = summary.readiness as any;

        // Resting heart rate is in contributors in Oura API v2
        const restingHR = readiness.contributors?.resting_heart_rate || 'unavailable';

        // Format the date nicely
        const date = new Date(summary.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

        const speakOutput = `For ${dayName}, your readiness score is ${readiness.score} out of 100. ` +
          `Your resting heart rate is ${restingHR} beats per minute.`;

        return handlerInput.responseBuilder
          .speak(speakOutput)
          .getResponse();
      } else {
        return handlerInput.responseBuilder
          .speak("I couldn't find your readiness data. Please try again later.")
          .getResponse();
      }
    } catch (error: any) {
      console.error('Error fetching readiness score:', error);
      return handlerInput.responseBuilder
        .speak("Sorry, I had trouble getting your readiness data. Please try again later.")
        .getResponse();
    }
  },
};

const ActivityScoreIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && getIntentName(handlerInput.requestEnvelope) === 'ActivityScoreIntent';
  },
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const ouraService = new OuraService();

    try {
      const summary = await ouraService.getTodaySummary();

      if (summary.activity) {
        const activity = summary.activity as any;

        // Format the date nicely
        const date = new Date(summary.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

        const speakOutput = `For ${dayName}, your activity score is ${activity.score} out of 100. ` +
          `You took ${activity.steps} steps and burned ${activity.calories_total} total calories, ` +
          `with ${activity.active_calories} active calories.`;

        return handlerInput.responseBuilder
          .speak(speakOutput)
          .getResponse();
      } else {
        return handlerInput.responseBuilder
          .speak("I couldn't find your activity data. Please try again later.")
          .getResponse();
      }
    } catch (error: any) {
      console.error('Error fetching activity score:', error);
      return handlerInput.responseBuilder
        .speak("Sorry, I had trouble getting your activity data. Please try again later.")
        .getResponse();
    }
  },
};

const ResilienceIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    const requestType = getRequestType(handlerInput.requestEnvelope);
    const intentName = getIntentName(handlerInput.requestEnvelope);
    const matches = requestType === 'IntentRequest' && intentName === 'ResilienceIntent';
    
    if (matches) {
      console.log('[ResilienceIntentHandler] Handler matched for ResilienceIntent');
    }
    
    return matches;
  },
  async handle(handlerInput: HandlerInput): Promise<Response> {
    console.log('[ResilienceIntentHandler] Handling ResilienceIntent request');
    const ouraService = new OuraService();

    try {
      console.log('[ResilienceIntentHandler] Fetching today summary...');
      const summary = await ouraService.getTodaySummary();
      console.log('[ResilienceIntentHandler] Summary fetched. Resilience data:', summary.resilience ? 'present' : 'missing');

      if (summary.resilience) {
        const resilience = summary.resilience;

        // Convert level to friendly description
        const levelDescriptions: { [key: string]: string } = {
          'exceptional': 'exceptional - you have achieved an ideal balance of stress and recovery',
          'strong': 'strong - your body is in a great place to handle upcoming challenges',
          'solid': 'solid - you have a good balance of stress and recovery',
          'adequate': 'adequate - you are hanging in there, but there is room for improvement',
          'limited': 'limited - there is a gap between your recovery and stress levels'
        };

        const description = levelDescriptions[resilience.level] || resilience.level;

        const speakOutput = `Your resilience level is ${description}. ` +
          `This is based on your balance of stress and recovery over the past two weeks.`;

        console.log('[ResilienceIntentHandler] Returning response with resilience level:', resilience.level);
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .getResponse();
      } else {
        console.log('[ResilienceIntentHandler] No resilience data found in summary');
        return handlerInput.responseBuilder
          .speak("I couldn't find your resilience data. You may need at least 5 days of data for Oura to calculate resilience.")
          .getResponse();
      }
    } catch (error: any) {
      console.error('[ResilienceIntentHandler] Error fetching resilience:', error);
      console.error('[ResilienceIntentHandler] Error stack:', error.stack);
      return handlerInput.responseBuilder
        .speak("Sorry, I had trouble getting your resilience data. Please try again later.")
        .getResponse();
    }
  },
};

const TrendReportIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && getIntentName(handlerInput.requestEnvelope) === 'TrendReportIntent';
  },
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const ouraService = new OuraService();

    try {
      const trends = await ouraService.getSevenDayTrends();

      const trendWords: { [key: string]: string } = {
        'rising': 'improving',
        'falling': 'declining',
        'stable': 'holding steady'
      };

      const speakOutput = `Here are your seven-day trends. ` +
        `Sleep: currently ${trends.sleep.current}, averaging ${trends.sleep.average}, ${trendWords[trends.sleep.trend]}. ` +
        `Readiness: currently ${trends.readiness.current}, averaging ${trends.readiness.average}, ${trendWords[trends.readiness.trend]}. ` +
        `Activity: currently ${trends.activity.current}, averaging ${trends.activity.average}, ${trendWords[trends.activity.trend]}.`;

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse();
    } catch (error: any) {
      console.error('Error fetching trends:', error);
      return handlerInput.responseBuilder
        .speak("Sorry, I had trouble calculating your trends. Please try again later.")
        .getResponse();
    }
  },
};

const HealthSummaryIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && getIntentName(handlerInput.requestEnvelope) === 'HealthSummaryIntent';
  },
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const ouraService = new OuraService();
    const smartHomeService = new SmartHomeService();

    try {
      const summary = await ouraService.getTodaySummary();

      // Format the date nicely
      const date = new Date(summary.date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

      let speakOutput = `Here is your health summary for ${dayName}: `;

      if (summary.sleep) {
        const sleep = summary.sleep as any;
        const hours = Math.floor(sleep.total_sleep_duration / 3600);
        // Sleep score is nested in sleep.readiness.score
        const sleepScore = sleep.readiness?.score || 'unavailable';
        speakOutput += `Sleep score: ${sleepScore}, you slept ${hours} hours. `;
      }

      if (summary.readiness) {
        speakOutput += `Readiness score: ${summary.readiness.score}. `;
      }

      if (summary.activity) {
        const activity = summary.activity as any;
        speakOutput += `Activity score: ${activity.score}, with ${activity.steps} steps. `;
      }

      if (summary.resilience) {
        speakOutput += `Resilience: ${summary.resilience.level}. `;
      }

      // Check and execute smart home actions
      if (smartHomeService.getConfig().enabled) {
        const executedActions = await smartHomeService.evaluateAndExecuteActions(summary);
        if (executedActions.length > 0) {
          speakOutput += ` I've also triggered ${executedActions.length} smart home action${executedActions.length > 1 ? 's' : ''} based on your scores.`;
        }
      }

      return handlerInput.responseBuilder
        .speak(speakOutput)
        .getResponse();
    } catch (error: any) {
      console.error('Error fetching health summary:', error);
      return handlerInput.responseBuilder
        .speak("Sorry, I had trouble getting your health data. Please try again later.")
        .getResponse();
    }
  },
};

const HelpIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput: HandlerInput): Response {
    const speakOutput = 'You can ask me about your sleep score, readiness score, activity score, resilience level, seven-day trends, or get a complete health summary. What would you like to know?';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(speakOutput)
      .getResponse();
  },
};

const CancelAndStopIntentHandler: RequestHandler = {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
        || getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(handlerInput: HandlerInput): Response {
    const speakOutput = 'Goodbye!';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .getResponse();
  },
};

const ErrorHandler = {
  canHandle(): boolean {
    return true;
  },
  handle(handlerInput: HandlerInput, error: Error): Response {
    const requestType = getRequestType(handlerInput.requestEnvelope);
    const intentName = getIntentName(handlerInput.requestEnvelope);
    
    console.error(`[ErrorHandler] Error caught - Request type: ${requestType}, Intent: ${intentName}`);
    console.error(`[ErrorHandler] Error message: ${error.message}`);
    console.error(`[ErrorHandler] Error stack: ${error.stack}`);

    return handlerInput.responseBuilder
      .speak('Sorry, I had trouble understanding. Please try again.')
      .reprompt('Sorry, I had trouble understanding. Please try again.')
      .getResponse();
  },
};

export const skillBuilder = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    SleepScoreIntentHandler,
    ReadinessScoreIntentHandler,
    ActivityScoreIntentHandler,
    HealthSummaryIntentHandler,
    ResilienceIntentHandler,
    TrendReportIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('oura-health-alexa-skill/v1')
  .create();
