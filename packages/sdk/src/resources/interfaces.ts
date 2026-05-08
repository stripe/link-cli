import type {
  AuthTokens,
  CredentialType,
  DeviceAuthRequest,
  LineItem,
  PaymentMethod,
  RequestApprovalResponse,
  ShippingAddressRecord,
  SpendRequest,
  Total,
  UserInfo,
} from '@/types/index';

export interface IAuthResource {
  initiateDeviceAuth(clientName?: string): Promise<DeviceAuthRequest>;
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
  payment_details: string;
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

export interface CreateReportParams {
  domain: string;
  outcome: 'success' | 'blocked' | 'abandoned';
  spend_request_id: string;
  tags?: string[];
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
