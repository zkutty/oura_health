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
        const sleep = summary.sleep;
        const hours = Math.floor(sleep.total_sleep_duration / 3600);
        const minutes = Math.floor((sleep.total_sleep_duration % 3600) / 60);
        
        const speakOutput = `Last night, your sleep score was ${sleep.score} out of 100. ` +
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
        const readiness = summary.readiness;
        const speakOutput = `Your readiness score is ${readiness.score} out of 100. ` +
          `Your resting heart rate is ${readiness.resting_heart_rate} beats per minute.`;

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
        const activity = summary.activity;
        const speakOutput = `Your activity score is ${activity.score} out of 100. ` +
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
      
      let speakOutput = 'Here is your health summary: ';
      
      if (summary.sleep) {
        const hours = Math.floor(summary.sleep.total_sleep_duration / 3600);
        speakOutput += `Sleep score: ${summary.sleep.score}, you slept ${hours} hours. `;
      }
      
      if (summary.readiness) {
        speakOutput += `Readiness score: ${summary.readiness.score}. `;
      }
      
      if (summary.activity) {
        speakOutput += `Activity score: ${summary.activity.score}, with ${summary.activity.steps} steps. `;
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
    const speakOutput = 'You can ask me about your sleep score, readiness score, activity score, or get a complete health summary. What would you like to know?';

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
    console.error(`Error handled: ${error.message}`);

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
    HelpIntentHandler,
    CancelAndStopIntentHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withCustomUserAgent('oura-health-alexa-skill/v1')
  .create();
