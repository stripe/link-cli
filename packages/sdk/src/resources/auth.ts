import { hostname } from 'node:os';
import {
  type LinkOptions,
  type ResolvedLinkSdkConfig,
  requireFetchImplementation,
  resolveLinkSdkConfig,
} from '@/config';
import { LinkApiError, LinkTransportError } from '@/errors';
import type {
  IAuthResource,
  InitiateDeviceAuthOptions,
  SourceAction,
} from '@/resources/interfaces';
import type { AuthTokens, DeviceAuthRequest, JsonValue } from '@/types/index';

const CLIENT_ID = 'lwlpk_U7Qy7ThG69STZk';
const DEFAULT_SCOPE = 'userinfo:read payment_methods.agentic';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface OAuthError {
  error: string;
  error_description?: string;
}

function formatOAuthError(
  prefix: string,
  status: number,
  data: unknown,
  rawBody: string,
): string {
  const err = data as OAuthError | null;
  return `${prefix} (${status}): ${err?.error_description ?? err?.error ?? (rawBody || 'unknown error')}`;
}

function dedupe<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function buildAuthorizationDetails(
  sourceActions: readonly SourceAction[] | undefined,
  authorizationDetails: readonly JsonValue[] | undefined,
): JsonValue[] {
  const details: JsonValue[] = [];
  const uniqueSourceActions = dedupe(sourceActions ?? []);

  if (uniqueSourceActions.length > 0) {
    details.push({
      type: 'source',
      actions: uniqueSourceActions,
    });
  }

  if (authorizationDetails) {
    details.push(...authorizationDetails);
  }

  return details;
}

function appendAuthorizationDetailValue(
  params: URLSearchParams,
  key: string,
  value: JsonValue,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendAuthorizationDetailValue(params, `${key}[]`, entry);
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      appendAuthorizationDetailValue(params, `${key}[${entryKey}]`, entryValue);
    }
    return;
  }

  params.append(key, String(value));
}

function buildDeviceCodeForm(
  clientName: string,
  options: InitiateDeviceAuthOptions,
): URLSearchParams {
  const connectionLabel = `${clientName} on ${hostname()}`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: options.scope ?? DEFAULT_SCOPE,
    connection_label: connectionLabel,
    client_hint: clientName,
  });
  const authorizationDetails = buildAuthorizationDetails(
    options.sourceActions,
    options.authorizationDetails,
  );

  for (const detail of authorizationDetails) {
    appendAuthorizationDetailValue(params, 'authorization_details[]', detail);
  }

  return params;
}

function serializeFormBody(
  params: Record<string, string> | URLSearchParams,
): string {
  return params instanceof URLSearchParams
    ? params.toString()
    : new URLSearchParams(params).toString();
}

function serializeRedactedFormBody(
  params: Record<string, string> | URLSearchParams,
): string {
  const redacted = new URLSearchParams(params);
  if (redacted.has('device_code')) {
    redacted.set('device_code', '<redacted>');
  }
  if (redacted.has('refresh_token')) {
    redacted.set('refresh_token', '<redacted>');
  }
  return redacted.toString();
}

export class AuthResource implements IAuthResource {
  private readonly config: ResolvedLinkSdkConfig;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: LinkOptions = {}) {
    this.config = resolveLinkSdkConfig(options);
    this.fetchImpl = requireFetchImplementation(this.config);
  }

  private async postForm(
    url: string,
    params: Record<string, string> | URLSearchParams,
  ): Promise<{ status: number; data: unknown; rawBody: string }> {
    if (this.config.verbose) {
      this.config.logger.debug(
        `> POST ${url}\n${serializeRedactedFormBody(params)}`,
      );
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: serializeFormBody(params),
      });
    } catch (error) {
      throw new LinkTransportError(`Request failed: POST ${url}`, {
        cause: error,
      });
    }

    const rawBody = await response.text();

    let data: unknown = null;
    try {
      data = JSON.parse(rawBody);
    } catch {
      // non-JSON response (e.g., from load balancer)
    }

    if (this.config.verbose) {
      this.config.logger.debug(`< ${response.status} ${response.statusText}`);
      response.headers.forEach((value, key) => {
        this.config.logger.debug(`  ${key}: ${value}`);
      });
      this.config.logger.debug(JSON.stringify(data, null, 2) ?? rawBody);
    }

    return { status: response.status, data, rawBody };
  }

  async initiateDeviceAuth(
    options: InitiateDeviceAuthOptions = {},
  ): Promise<DeviceAuthRequest> {
    const effectiveName = options.clientName ?? this.config.clientName;
    const params = buildDeviceCodeForm(effectiveName, options);
    const { status, data, rawBody } = await this.postForm(
      `${this.config.authBaseUrl}/device/code`,
      params,
    );

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        formatOAuthError(
          'Device auth initiation failed',
          status,
          data,
          rawBody,
        ),
        { status, rawBody, details: data },
      );
    }

    const resp = data as DeviceCodeResponse;
    return {
      device_code: resp.device_code,
      user_code: resp.user_code,
      verification_url: resp.verification_uri,
      verification_url_complete: resp.verification_uri_complete,
      expires_in: resp.expires_in,
      interval: resp.interval,
    };
  }

  async pollDeviceAuth(deviceCode: string): Promise<AuthTokens | null> {
    const { status, data, rawBody } = await this.postForm(
      `${this.config.authBaseUrl}/device/token`,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: CLIENT_ID,
      },
    );

    if (status >= 200 && status < 300) {
      const resp = data as TokenResponse;
      return {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        expires_in: resp.expires_in,
        token_type: resp.token_type,
      };
    }

    if (status === 400) {
      const err = data as OAuthError;
      switch (err.error) {
        case 'authorization_pending':
        case 'slow_down':
          return null;
        case 'expired_token':
          throw new LinkApiError(
            'Device code expired. Please restart the login flow.',
            { status, code: err.error, rawBody, details: data },
          );
        case 'access_denied':
          throw new LinkApiError('Authorization denied by user.', {
            status,
            code: err.error,
            rawBody,
            details: data,
          });
      }
    }

    throw new LinkApiError(
      formatOAuthError('Token poll failed', status, data, rawBody),
      {
        status,
        code: (data as OAuthError | null)?.error,
        rawBody,
        details: data,
      },
    );
  }

  async revokeToken(token: string): Promise<void> {
    const { status, data, rawBody } = await this.postForm(
      `${this.config.authBaseUrl}/device/revoke`,
      {
        client_id: CLIENT_ID,
        token,
      },
    );

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        formatOAuthError('Token revocation failed', status, data, rawBody),
        {
          status,
          code: (data as OAuthError | null)?.error,
          rawBody,
          details: data,
        },
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const { status, data, rawBody } = await this.postForm(
      `${this.config.authBaseUrl}/device/token`,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      },
    );

    if (status < 200 || status >= 300) {
      throw new LinkApiError(
        formatOAuthError('Token refresh failed', status, data, rawBody),
        {
          status,
          code: (data as OAuthError | null)?.error,
          rawBody,
          details: data,
        },
      );
    }

    const resp = data as TokenResponse;
    return {
      access_token: resp.access_token,
      refresh_token: resp.refresh_token,
      expires_in: resp.expires_in,
      token_type: resp.token_type,
    };
  }
}
