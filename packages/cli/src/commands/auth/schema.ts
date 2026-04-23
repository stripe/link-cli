import { z } from 'zod';
import type { InputSchema, OutputSchema } from '../../utils/json-options';

export const LOGIN_INPUT_SCHEMA: InputSchema = {
  client_name: {
    schema: z.string().trim().min(1),
    flag: '--client-name <name>',
    description: 'Agent or app name shown in the Link app',
    jsonDescription:
      'Shown to the user when approving the device connection — use a short, recognizable name (e.g. "Personal Assistant")',
    defaultValue: 'Link CLI',
  },
};

export const LOGIN_SCHEMA: OutputSchema = {
  authenticated: {
    outputExample: 'true',
    description: 'Is the user authenticated with Link',
  },
  token_type: { outputExample: '"..."', description: 'Token type' },
};

export const LOGOUT_SCHEMA: OutputSchema = {
  authenticated: {
    outputExample: 'false',
    description: 'Is the user authenticated with Link',
  },
};

export const AUTH_STATUS_SCHEMA: OutputSchema = {
  authenticated: {
    outputExample: 'true',
    description: 'Is the user authenticated with Link',
  },
  access_token: {
    outputExample: '"liwltoken_abdec12345..." (truncated)',
    description: 'Access token (truncated)',
  },
  token_type: { outputExample: '"Bearer"', description: 'Token type' },
  credentials_path: {
    outputExample: '"~/.link-cli-nodejs/config.json"',
    description: 'Path to credentials file',
  },
};
