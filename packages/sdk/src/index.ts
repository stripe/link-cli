export { LinkAuthResource } from './auth/auth-resource';
export { buildAuthorizationDetails } from './auth/authorization-details';
export type { AuthResourceOptions } from './auth/config';
export {
  LinkAuthenticationError,
  LinkAuthorizationDeclinedError,
  type ScopeEligibility,
} from './auth/errors';
export {
  DEFAULT_SCOPE,
  DEFAULT_SCOPES,
  normalizeScopeInput,
} from './auth/scopes';
export {
  type CreateAccessTokenProviderOptions,
  createAccessTokenProvider,
} from './auth/session';
export * from './auth/types';
export { default, Link } from './client';
export type { LinkOptions, LinkSdkLogger } from './config';
export {
  LinkApiError,
  LinkConfigurationError,
  LinkResponseError,
  LinkSdkError,
  LinkTransportError,
} from './errors';
export { ApprovalPolicyResource } from './resources/approval-policy';
export * from './resources/attestations';
export { BaseResource } from './resources/base';
export {
  holderJwksEqual,
  holderJwkThumbprint,
  parseHolderPublicJwk,
} from './resources/holder-jwk';
export { InsightsResource } from './resources/insights';
export * from './resources/interfaces';
export { getDuplicateSpendRequest } from './resources/spend-request';
export * from './types/index';
