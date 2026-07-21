import type {
  ApprovalDetail,
  AuthTokens,
  BalancesPage,
  CredentialType,
  DeviceAuthRequest,
  JsonValue,
  LineItem,
  PaymentMethod,
  RequestApprovalResponse,
  ShippingAddressRecord,
  SourcesPage,
  SpendRequest,
  Total,
  TransactionOrigin,
  TransactionsPage,
  UserInfo,
  WebBotAuthBlock,
} from '@/types/index';
import type {
  UcpCartCreateParams,
  UcpCartUpdateParams,
  UcpCatalogLookupParams,
  UcpCatalogSearchParams,
  UcpCheckoutCompleteParams,
  UcpCheckoutCreateParams,
  UcpCheckoutUpdateParams,
  UcpDiscoveryResult,
  UcpOperationResult,
} from './ucp-types';

export const SOURCE_ACTIONS = [
  'read_balances',
  'read_external_transactions',
  'read_link_transactions',
  'read_source_details',
] as const;

export type SourceAction = (typeof SOURCE_ACTIONS)[number];

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

export interface GetAccessTokenOptions {
  forceRefresh?: boolean;
}

export type AccessTokenProvider = (
  options?: GetAccessTokenOptions,
) => Promise<string> | string;

export interface CreateSpendRequestParams {
  payment_details?: string;
  credential_type?: CredentialType;
  network_id?: string;
  amount?: number;
  currency?: string;
  merchant_name?: string;
  merchant_url?: string;
  context: string;
  line_items?: LineItem[];
  totals?: Total[];
  request_approval?: boolean;
  test?: boolean;
  approve?: boolean;
  approval_details?: ApprovalDetail;
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
  listSpendRequests(opts?: { includeHistory?: boolean }): Promise<
    SpendRequest[]
  >;
  create(params: CreateSpendRequestParams): Promise<SpendRequest>;
  createSpendRequest(params: CreateSpendRequestParams): Promise<SpendRequest>;
  update(id: string, params: UpdateSpendRequestParams): Promise<SpendRequest>;
  updateSpendRequest(
    id: string,
    params: UpdateSpendRequestParams,
  ): Promise<SpendRequest>;
  requestApproval(id: string): Promise<RequestApprovalResponse>;
  cancel(id: string): Promise<SpendRequest>;
  cancelSpendRequest(id: string): Promise<SpendRequest>;
  retrieve(
    id: string,
    opts?: { include?: string[] },
  ): Promise<SpendRequest | null>;
  getSpendRequest(
    id: string,
    opts?: { include?: string[] },
  ): Promise<SpendRequest | null>;
}

export interface IPaymentMethodsResource {
  list(): Promise<PaymentMethod[]>;
  listPaymentMethods(): Promise<PaymentMethod[]>;
}

export interface IShippingAddressResource {
  list(): Promise<ShippingAddressRecord[]>;
  listShippingAddresses(): Promise<ShippingAddressRecord[]>;
}

export interface IUserInfoResource {
  retrieve(): Promise<UserInfo>;
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
  listTransactions(params?: ListTransactionsParams): Promise<TransactionsPage>;
}

export interface ListSourcesParams {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface ISourcesResource {
  list(params?: ListSourcesParams): Promise<SourcesPage>;
  listSources(params?: ListSourcesParams): Promise<SourcesPage>;
}

export interface ListBalancesParams {
  sources?: string[];
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface IBalancesResource {
  list(params?: ListBalancesParams): Promise<BalancesPage>;
  listBalances(params?: ListBalancesParams): Promise<BalancesPage>;
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

export interface CreateReportParams {
  domain: string;
  outcome: ReportOutcome;
  spend_request_id: string;
  tags?: ReportTag[];
  step?: string;
  freeform_context?: string;
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

export interface IUcpResource {
  discover(businessUrl: string): Promise<UcpDiscoveryResult>;
  catalogSearch(
    businessUrl: string,
    params: UcpCatalogSearchParams,
  ): Promise<UcpOperationResult>;
  catalogLookup(
    businessUrl: string,
    params: UcpCatalogLookupParams,
  ): Promise<UcpOperationResult>;
  cartCreate(
    businessUrl: string,
    params: UcpCartCreateParams,
  ): Promise<UcpOperationResult>;
  cartGet(businessUrl: string, cartId: string): Promise<UcpOperationResult>;
  cartUpdate(
    businessUrl: string,
    cartId: string,
    params: UcpCartUpdateParams,
  ): Promise<UcpOperationResult>;
  checkoutCreate(
    businessUrl: string,
    params: UcpCheckoutCreateParams,
  ): Promise<UcpOperationResult>;
  checkoutGet(
    businessUrl: string,
    checkoutId: string,
  ): Promise<UcpOperationResult>;
  checkoutUpdate(
    businessUrl: string,
    checkoutId: string,
    params: UcpCheckoutUpdateParams,
  ): Promise<UcpOperationResult>;
  checkoutComplete(
    businessUrl: string,
    checkoutId: string,
    params?: UcpCheckoutCompleteParams,
  ): Promise<UcpOperationResult>;
}
