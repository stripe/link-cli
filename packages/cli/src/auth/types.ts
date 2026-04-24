import type { AuthTokens } from '@stripe/link-sdk';

export interface DeviceAuthRequest {
  device_code: string;
  user_code: string;
  verification_url: string;
  verification_url_complete: string;
  expires_in: number;
  interval: number;
}

export interface IAuthResource {
  initiateDeviceAuth(clientName?: string): Promise<DeviceAuthRequest>;
  pollDeviceAuth(deviceCode: string): Promise<AuthTokens | null>;
  refreshToken(refreshToken: string): Promise<AuthTokens>;
  revokeToken(token: string): Promise<void>;
}
