import type {
  ApprovalDetail,
  ApprovalPolicy,
  AvailableInsightTypesPage,
  BalancesPage,
  CredentialType,
  InsightsPage,
  LineItem,
  PaymentMethod,
  RecurringInterval,
  RequestApprovalResponse,
  ShippingAddressRecord,
  SourcesPage,
  SpendRequest,
  Total,
  TransactionOrigin,
  TransactionsPage,
  UcpCheckout,
  UcpCheckoutWithSpendRequest,
  UcpSearchResult,
  UserInfo,
  WebBotAuthBlock,
} from '@/types/index';

export interface GetAccessTokenOptions {
  forceRefresh?: boolean;
}

export type AccessTokenProvider = (
  options?: GetAccessTokenOptions,
) => Promise<string> | string;

export interface AttestationRequestParams {
  count: number;
}

export interface AttestationRequestResult {
  tokens: string[];
  issuer: string;
  token_key_id: string;
  count: number;
}

export interface IAttestationsResource {
  request(params: AttestationRequestParams): Promise<AttestationRequestResult>;
}

export type HolderPublicJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string };

export interface IssueIdentityCredentialParams {
  cnf: { jwk: HolderPublicJwk };
}

export interface IssueIdentityCredentialResponse {
  credential: string;
  issuer: string;
  expires_at: string;
}

export interface IIdentityCredentialsResource {
  issue(
    params: IssueIdentityCredentialParams,
  ): Promise<IssueIdentityCredentialResponse>;
}

export interface SpendRequestRecurringParams {
  interval: RecurringInterval;
  /** Positive number of intervals per period. Defaults to 1 on the server. */
  interval_count?: number;
}

export interface CreateSpendRequestParams {
  idempotency_key?: string;
  /**
   * Callback destination included in returned approval and supported action URLs.
   * Must be supplied together with nonce. The API validates URL security.
   */
  completion_callback_url?: string;
  /**
   * Opaque callback nonce. Supply together with completion_callback_url,
   * save unchanged, and verify an exact match when the callback is received.
   */
  nonce?: string;
  payment_details?: string;
  credential_type?: CredentialType;
  network_id?: string;
  merchant_account_id?: string;
  amount?: number;
  currency?: string;
  merchant_name?: string;
  merchant_url?: string;
  context: string;
  line_items?: LineItem[];
  totals?: Total[];
  request_approval?: boolean;
  test?: boolean;
  approval_details?: ApprovalDetail;
  metadata?: Record<string, string>;
  recurring?: SpendRequestRecurringParams;
  /** Create via the delegated approval flow, routing to /create_delegated. */
  approve?: boolean;
  /**
   * Auto-approve within the user's configured approval policy, through the
   * delegated approval flow (beta, available only to select OAuth clients).
   */
  use_approval_policy?: boolean;
}

export interface UpdateSpendRequestParams {
  payment_details?: string;
  amount?: number;
  merchant_url?: string;
  profile_id?: string;
  merchant_id?: string;
  currency?: string;
  line_items?: LineItem[];
  totals?: Total[];
  /** Update via the delegated approval flow, routing to /update_delegated. */
  approve?: boolean;
  /**
   * Auto-approve within the user's configured approval policy, through the
   * delegated approval flow (beta, available only to select OAuth clients).
   */
  use_approval_policy?: boolean;
}

export interface ISpendRequestResource {
  list(opts?: { includeHistory?: boolean }): Promise<SpendRequest[]>;
  create(params: CreateSpendRequestParams): Promise<SpendRequest>;
  update(id: string, params: UpdateSpendRequestParams): Promise<SpendRequest>;
  requestApproval(id: string): Promise<RequestApprovalResponse>;
  cancel(id: string): Promise<SpendRequest>;
  retrieve(
    id: string,
    opts?: { include?: string[] },
  ): Promise<SpendRequest | null>;
}

export interface MppRequest {
  url: string;
  method?: string;
  body?: string;
  headers?: HeadersInit;
}

export interface MppPayOptions {
  spendRequestId: string;
}

export interface MppPaymentResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface DecodedMppChallengeBase {
  id: string;
  realm: string;
  description?: string;
  digest?: string;
  expires?: string;
  header?: string;
  meta?: Record<string, string>;
  opaque?: string;
}

export interface DecodedStripeChallengeRequest extends Record<string, unknown> {
  amount: string;
  currency: string;
  networkId?: string;
  methodDetails?: {
    networkId: string;
    paymentMethodTypes?: string[];
    metadata?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface DecodedStripeChallenge extends DecodedMppChallengeBase {
  method: 'stripe';
  intent: 'charge' | 'session';
  network_id: string;
  request_json: DecodedStripeChallengeRequest;
}

/** Supported decoded MPP challenges. Add new method variants to this union. */
export type DecodedMppChallenge = DecodedStripeChallenge;

export type MppDecodeResult =
  | { payment_required: true; challenges: DecodedMppChallenge[] }
  | { payment_required: false; response: MppPaymentResult };

export interface IMppResource {
  /**
   * Probes a URL for a Machine Payment Protocol challenge, without sending
   * any payment credential. Follows safe redirects the way a browser would.
   */
  decode(request: MppRequest): Promise<MppDecodeResult>;
  /**
   * Re-fetches the challenge at `request`, verifies it matches the terms of
   * the already-approved `spendRequestId`, then pays it with a shared
   * payment token. Safe to retry with the same arguments after an uncertain
   * result (e.g. a 503) — a non-402 re-fetch is simply returned as-is.
   */
  pay(request: MppRequest, options: MppPayOptions): Promise<MppPaymentResult>;
}

export interface IPaymentMethodsResource {
  list(): Promise<PaymentMethod[]>;
  retrieve(id: string): Promise<PaymentMethod | null>;
  update(id: string, params: UpdatePaymentMethodParams): Promise<PaymentMethod>;
}

export interface UpdatePaymentMethodParams {
  nickname?: string;
  is_default?: boolean;
}

export interface IShippingAddressResource {
  list(): Promise<ShippingAddressRecord[]>;
}

export interface IUserInfoResource {
  retrieve(): Promise<UserInfo>;
}

export interface IApprovalPolicyResource {
  retrieve(): Promise<ApprovalPolicy>;
}

export interface IWebBotAuthResource {
  signUrl(url: string): Promise<WebBotAuthBlock>;
}

export interface ListTransactionsParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
  start_date?: string;
  end_date?: string;
  category?: string;
  origin?: TransactionOrigin;
  sources?: string[];
}

export interface ITransactionsResource {
  list(params?: ListTransactionsParams): Promise<TransactionsPage>;
}

export interface ListInsightTypesParams {
  limit?: number;
  starting_after?: string;
}

export interface ListInsightsParams extends ListInsightTypesParams {
  insights?: string[];
}

export interface IInsightsResource {
  listAvailableTypes(
    params?: ListInsightTypesParams,
  ): Promise<AvailableInsightTypesPage>;
  list(params?: ListInsightsParams): Promise<InsightsPage>;
}

export interface ListSourcesParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface ISourcesResource {
  list(params?: ListSourcesParams): Promise<SourcesPage>;
}

export interface ListBalancesParams {
  sources?: string[];
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface IBalancesResource {
  list(params?: ListBalancesParams): Promise<BalancesPage>;
}

export const REPORT_OUTCOMES = ['success', 'blocked', 'abandoned'] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export const REPORT_TAGS = [
  'stripe_checkout',
  'captcha',
  'anti_bot_script',
  'cdn_block',
  'waf_block',
  'dns_block',
  'rate_limited',
  'login_required',
  '3ds_challenge',
  'page_inaccessible',
  'timeout',
  'site_error',
  'payment_declined',
  'other',
] as const;
export type ReportTag = (typeof REPORT_TAGS)[number];

/**
 * Server-side cap on `attempt_trace`. Longer values are truncated by the API
 * rather than rejected, so callers do not need to pre-trim.
 */
export const REPORT_ATTEMPT_TRACE_MAX_LENGTH = 8000;

export interface CreateReportParams {
  domain: string;
  outcome: ReportOutcome;
  spend_request_id: string;
  tags?: ReportTag[];
  step?: string;
  freeform_context?: string;
  attempt_trace?: string;
}

export interface ReportRecord {
  object: string;
  created_at: string;
  domain: string;
  outcome: string;
  spend_request_id: string;
  status: string;
}

export interface IReportResource {
  create(params: CreateReportParams): Promise<ReportRecord>;
}

export interface SearchUcpCatalogParams {
  query?: string;
  profile_id?: string;
  sku?: string;
  brand?: string[];
  category?: string[];
  color?: string[];
  size?: string[];
  material?: string[];
  gender?: string[];
  condition?: string[];
  price_min?: number;
  price_max?: number;
  currency?: string;
  availability?: string;
  sort?: string;
  group_by?: string;
  limit?: number;
  offset?: number;
  include_facets?: boolean;
  test?: boolean;
}

export interface UcpLineItem {
  sku_id: string;
  quantity: number;
}

export interface CreateUcpCheckoutParams {
  profile_id: string;
  line_items: UcpLineItem[];
  currency?: string;
  fulfillment_details?: Record<string, unknown>;
  test?: boolean;
}

export interface CompleteUcpCheckoutParams {
  spend_request_id: string;
  profile_id: string;
  test?: boolean;
}

export interface RetrieveUcpCheckoutParams {
  spend_request_id: string;
  test?: boolean;
}

export interface IUcpResource {
  searchCatalog(params: SearchUcpCatalogParams): Promise<UcpSearchResult>;
  createCheckout(params: CreateUcpCheckoutParams): Promise<UcpCheckout>;
  completeCheckout(
    id: string,
    params: CompleteUcpCheckoutParams,
  ): Promise<UcpCheckout>;
  retrieveCheckout(
    id: string,
    params: RetrieveUcpCheckoutParams,
  ): Promise<UcpCheckoutWithSpendRequest>;
}
