// Type definitions for environment variables
declare namespace NodeJS {
  interface ProcessEnv {
    OURA_CLIENT_ID: string;
    OURA_CLIENT_SECRET: string;
    OURA_ACCESS_TOKEN: string;
    OURA_REFRESH_TOKEN?: string;
    PORT?: string;
    NODE_ENV?: 'development' | 'production';
    ALEXA_SKILL_ID?: string;
    SMART_HOME_ENABLED?: string;
  }
}
