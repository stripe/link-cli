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
  /**
   * Spend request expiry in Unix seconds or an ISO 8601 timestamp ending in Z (UTC).
   * ISO input is converted to Unix seconds. Set for delayed merchant charges.
   * At least 3 hours ahead; at most 365 days for one-time or 1827 days for
   * recurring requests, subject to country limits. Defaults to 7 days for
   * one-time requests or the country maximum for recurring requests.
   * Does not extend the approval window.
   */
  expires_at?: number | string;
  recurring?: SpendRequestRecurringParams;
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
  /** `www_authenticate` from `decode`. `pay` refuses a re-fetched challenge whose terms differ. */
  approvedChallenge?: string;
}

export interface MppPaymentResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface DecodedStripeChallenge {
  id: string;
  realm: string;
  method: 'stripe';
  intent: 'charge' | 'session';
  description?: string;
  digest?: string;
  expires?: string;
  network_id: string;
  request_json: { amount: string; currency: string; [key: string]: unknown };
}

export type MppDecodeResult =
  | {
      payment_required: true;
      challenges: DecodedStripeChallenge[];
      /** The challenge header. Pass this to `pay` as `approvedChallenge`. */
      www_authenticate: string;
      /** The request after redirects. Pass this to `pay`. */
      request: MppRequest;
    }
  | { payment_required: false; response: MppPaymentResult };

export interface IMppResource {
  /** Probes a URL for an MPP challenge without sending a payment credential. */
  decode(request: MppRequest): Promise<MppDecodeResult>;
  /** Re-fetches the challenge, checks it against the approved spend request's terms and any `approvedChallenge`, and pays with its shared payment token. */
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
  business?: string;
  sku?: string;
  brand?: string[];
  category?: string[];
  color?: string[];
  size?: string[];
  condition?: Array<'new' | 'used' | 'refurbished'>;
  /** Minimum price in currency-specific minor units; requires currency. */
  price_min?: number;
  /** Maximum price in currency-specific minor units; requires currency. */
  price_max?: number;
  /** Supported lowercase three-letter currency code, e.g. usd. */
  currency?: string;
  sort?: 'relevance' | 'price_asc' | 'price_desc';
  limit?: number;
  offset?: number;
  include_facets?: boolean;
  test?: boolean;
}

export interface UcpLineItem {
  item: { id: string };
  quantity?: number;
}

export interface UcpBuyer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
}

export interface CreateUcpCheckoutParams {
  business: string;
  line_items: UcpLineItem[];
  buyer?: UcpBuyer;
  fulfillment?: Record<string, unknown>;
}

/** Omitted line_items, buyer, and fulfillment sections keep existing checkout values. */
export interface UpdateUcpCheckoutParams
  extends Omit<CreateUcpCheckoutParams, 'line_items'> {
  line_items?: (UcpLineItem & { id?: string; parent_id?: string })[];
}

export interface CompleteUcpCheckoutParams {
  spend_request_id: string;
  business: string;
}

export interface CancelUcpCheckoutParams {
  business: string;
}

export interface RetrieveUcpCheckoutParams {
  business: string;
}

export interface IUcpResource {
  searchCatalog(params: SearchUcpCatalogParams): Promise<UcpSearchResult>;
  createCheckout(params: CreateUcpCheckoutParams): Promise<UcpCheckout>;
  updateCheckout(
    id: string,
    params: UpdateUcpCheckoutParams,
  ): Promise<UcpCheckout>;
  completeCheckout(
    id: string,
    params: CompleteUcpCheckoutParams,
  ): Promise<UcpCheckout>;
  cancelCheckout(
    id: string,
    params: CancelUcpCheckoutParams,
  ): Promise<UcpCheckout>;
  retrieveCheckout(
    id: string,
    params: RetrieveUcpCheckoutParams,
  ): Promise<UcpCheckout>;
}
