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

/** PUT replaces checkout state; include every section you want to retain. */
export interface UpdateUcpCheckoutParams extends CreateUcpCheckoutParams {
  line_items: (UcpLineItem & { id?: string; parent_id?: string })[];
}

export interface CompleteUcpCheckoutParams {
  spend_request_id: string;
  business: string;
}

export interface RetrieveUcpCheckoutParams {
  business: string;
  /** Fetch payment state separately and attach it to the checkout. */
  spend_request_id?: string;
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
  retrieveCheckout(
    id: string,
    params: RetrieveUcpCheckoutParams & { spend_request_id: string },
  ): Promise<UcpCheckoutWithSpendRequest>;
  retrieveCheckout(
    id: string,
    params: RetrieveUcpCheckoutParams,
  ): Promise<UcpCheckout>;
}
