import { LinkSdkError } from '@stripe/link-sdk';

export class LinkAuthenticationError extends LinkSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { code: 'not_authenticated', ...options });
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
      { code: 'authorization_declined' },
    );
    this.scopeEligibility = scopeEligibility;
  }
}
