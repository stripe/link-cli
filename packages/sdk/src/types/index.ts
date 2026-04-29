export interface DeviceAuthRequest {
  device_code: string;
  user_code: string;
  verification_url: string;
  verification_url_complete: string;
  expires_in: number;
  interval: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  /** Absolute epoch-ms when the access token expires (computed on store). */
  expires_at?: number;
}

export interface LineItem {
  name: string;
  url?: string;
  image_url?: string;
  description?: string;
  sku?: string;
  totals?: Total[];
  quantity?: number;
  unit_amount?: number;
  product_url?: string;
}

export interface Total {
  type: string;
  display_text: string;
  amount: number;
}

export interface BillingAddress {
  name: string;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country: string;
}

export interface Card {
  id: string;
  brand: string;
  exp_month: number;
  exp_year: number;
  number: string;
  cvc?: string;
  billing_address?: BillingAddress;
  valid_until?: string;
}

export type SpendRequestStatus =
  | 'created'
  | 'pending_approval'
  | 'expired'
  | 'approved'
  | 'denied'
  | 'succeeded'
  | 'failed';

export type CredentialType = 'shared_payment_token' | 'card';

export interface SharedPaymentToken {
  id: string;
  billing_address?: BillingAddress;
  valid_until?: string;
}

export interface SpendRequest {
  id: string;
  merchant_name?: string;
  merchant_url?: string;
  context?: string;
  amount?: number;
  currency?: string;
  line_items: LineItem[];
  totals: Total[];
  payment_method?: string;
  payment_details: string;
  credential_type?: CredentialType;
  network_id?: string;
  status: SpendRequestStatus;
  approval_url?: string;
  card?: Card;
  shared_payment_token?: SharedPaymentToken;
  created_at: string;
  updated_at: string;
}

export interface RequestApprovalResponse {
  id: string;
  approval_link: string;
}

export interface CardDetails {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

export interface BankAccountDetails {
  last4: string;
  bank_name?: string;
}

export interface PaymentMethod {
  id: string;
  type: string;
  is_default: boolean;
  nickname?: string;
  card_details?: CardDetails;
  bank_account_details?: BankAccountDetails;
}
