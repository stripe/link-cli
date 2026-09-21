export { default, Link } from './client';
export type { LinkOptions, LinkSdkLogger } from './config';
export {
  LinkApiError,
  LinkConfigurationError,
  LinkResponseError,
  LinkSdkError,
  LinkTransportError,
} from './errors';
export * from './resources/attestations';
export * from './resources/interfaces';
export { getDuplicateSpendRequest } from './resources/spend-request';
export * from './resources/summaries';
export * from './types/index';
