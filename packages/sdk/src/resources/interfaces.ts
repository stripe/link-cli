import type {
  ApprovalDetail,
  BalancesPage,
  CredentialType,
  LineItem,
  PaymentMethod,
  RequestApprovalResponse,
  ShippingAddressRecord,
  SourcesPage,
  SpendRequest,
  Total,
  Transaction,
  TransactionOrigin,
  TransactionsPage,
  UserInfo,
  WebBotAuthBlock,
} from '@/types/index';

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
  execution_method?: 'link_pay_token';
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
}

export interface IShippingAddressResource {
  list(): Promise<ShippingAddressRecord[]>;
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

export interface UpdateTransactionParams {
  category?: string;
  description?: string;
}

export interface ITransactionsResource {
  list(params?: ListTransactionsParams): Promise<TransactionsPage>;
  update(id: string, params: UpdateTransactionParams): Promise<Transaction>;
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
