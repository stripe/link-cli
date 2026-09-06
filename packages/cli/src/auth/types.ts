import type { JsonValue as LinkJsonValue } from '@stripe/link-sdk';

export const SOURCE_ACTIONS = [
  'read_balances',
  'read_external_transactions',
  'read_link_transactions',
  'read_source_details',
  'write_external_transactions',
  'write_link_transactions',
] as const;

export type SourceAction = (typeof SOURCE_ACTIONS)[number];

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  /** Absolute epoch-ms when the access token expires. */
  expires_at?: number;
  scope?: string;
  authorization_details?: LinkJsonValue[];
}

export interface AuthStorage {
  getTokens(): AuthTokens | null | Promise<AuthTokens | null>;
  setTokens(tokens: AuthTokens): void | Promise<void>;
  clearTokens(): void | Promise<void>;
}

export interface DeviceAuthRequest {
  device_code: string;
  user_code: string;
  verification_url: string;
  verification_url_complete: string;
  expires_in: number;
  interval: number;
}

export type JsonValue = LinkJsonValue;

export interface InitiateDeviceAuthOptions {
  clientName?: string;
  scope?: string;
  sourceActions?: SourceAction[];
  authorizationDetails?: JsonValue[];
}

export interface IAuthResource {
  initiateDeviceAuth(
    options?: InitiateDeviceAuthOptions,
  ): Promise<DeviceAuthRequest>;
  pollDeviceAuth(deviceCode: string): Promise<AuthTokens | null>;
  refreshToken(refreshToken: string): Promise<AuthTokens>;
  revokeToken(token: string): Promise<void>;
}
