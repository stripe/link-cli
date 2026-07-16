import type {
  AuthTokens,
  JsonValue as LinkJsonValue,
  SourceAction,
} from '@stripe/link-sdk';

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
