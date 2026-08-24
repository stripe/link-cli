import { ZodError, prettifyError } from 'zod';

export class LinkSdkError extends Error {
  readonly code: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.code = options?.code ?? 'sdk_error';
  }
}

export class LinkResponseError extends LinkSdkError {
  readonly status: number;

  constructor(
    operation: string,
    status: number,
    options?: { cause?: unknown },
  ) {
    const detail =
      options?.cause instanceof ZodError
        ? `: ${prettifyError(options.cause)}`
        : options?.cause instanceof Error
          ? `: ${options.cause.message}`
          : '';
    super(
      `Invalid response while attempting to ${operation} (${status})${detail}`,
      { code: 'invalid_response', cause: options?.cause },
    );
    this.status = status;
  }
}

export class LinkConfigurationError extends LinkSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { code: 'configuration_error', ...options });
  }
}

export class LinkAuthenticationError extends LinkSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { code: 'not_authenticated', ...options });
  }
}

export class LinkTransportError extends LinkSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { code: 'transport_error', ...options });
  }
}

export interface ScopeEligibility {
  eligible: boolean;
  ineligibility_reasons: string[];
  description?: string;
}

export class LinkAuthorizationDeclinedError extends LinkSdkError {
  readonly scopeEligibility: Record<string, ScopeEligibility>;

  constructor(scopeEligibility: Record<string, ScopeEligibility>) {
    super(
      'Authorization declined: account is not eligible for requested scopes',
      {
        code: 'authorization_declined',
      },
    );
    this.scopeEligibility = scopeEligibility;
  }
}

export class LinkApiError extends LinkSdkError {
  readonly status: number;
  readonly rawBody?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      rawBody?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { code: options.code ?? 'api_error', cause: options.cause });
    this.status = options.status;
    this.rawBody = options.rawBody;
    this.details = options.details;
  }
}
