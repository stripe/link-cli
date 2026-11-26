import type { LinkOptions } from './config.js';
import { ApprovalPolicyResource } from './resources/approval-policy.js';
import { AttestationsResource } from './resources/attestations.js';
import { BalancesResource } from './resources/balances.js';
import { IdentityCredentialsResource } from './resources/identity-credentials.js';
import { InsightsResource } from './resources/insights.js';
import type {
  IApprovalPolicyResource,
  IAttestationsResource,
  IBalancesResource,
  IIdentityCredentialsResource,
  IInsightsResource,
  IMppResource,
  IPaymentMethodsResource,
  IReportResource,
  IShippingAddressResource,
  ISourcesResource,
  ISpendRequestResource,
  ITransactionsResource,
  IUcpResource,
  IUserInfoResource,
  IWebBotAuthResource,
} from './resources/interfaces.js';
import { MppResource } from './resources/mpp.js';
import { PaymentMethodsResource } from './resources/payment-methods.js';
import { ReportResource } from './resources/report.js';
import { ShippingAddressResource } from './resources/shipping-address.js';
import { SourcesResource } from './resources/sources.js';
import { SpendRequestResource } from './resources/spend-request.js';
import { TransactionsResource } from './resources/transactions.js';
import { UcpResource } from './resources/ucp.js';
import { UserInfoResource } from './resources/user-info.js';
import { WebBotAuthResource } from './resources/web-bot-auth.js';

export class Link {
  readonly attestations: IAttestationsResource;
  readonly identityCredentials: IIdentityCredentialsResource;
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;
  readonly shippingAddresses: IShippingAddressResource;
  readonly userInfo: IUserInfoResource;
  readonly approvalPolicy: IApprovalPolicyResource;
  readonly transactions: ITransactionsResource;
  readonly insights: IInsightsResource;
  readonly sources: ISourcesResource;
  readonly balances: IBalancesResource;
  readonly webBotAuth: IWebBotAuthResource;
  readonly reports: IReportResource;
  readonly ucp: IUcpResource;
  readonly mpp: IMppResource;

  constructor(options: LinkOptions) {
    this.attestations = new AttestationsResource(options);
    this.identityCredentials = new IdentityCredentialsResource(options);
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
    this.shippingAddresses = new ShippingAddressResource(options);
    this.userInfo = new UserInfoResource(options);
    this.approvalPolicy = new ApprovalPolicyResource(options);
    this.transactions = new TransactionsResource(options);
    this.insights = new InsightsResource(options);
    this.sources = new SourcesResource(options);
    this.balances = new BalancesResource(options);
    this.webBotAuth = new WebBotAuthResource(options);
    this.reports = new ReportResource(options);
    this.ucp = new UcpResource(options);
    this.mpp = new MppResource(options, this.spendRequests);
  }
}

export default Link;
