import type { LinkOptions } from '@/config';
import { AttestationsResource } from '@/resources/attestations';
import { BalancesResource } from '@/resources/balances';
import type {
  IAttestationsResource,
  IBalancesResource,
  IPaymentMethodsResource,
  IReportResource,
  IShippingAddressResource,
  ISourcesResource,
  ISpendingPolicyResource,
  ISpendRequestResource,
  ISummariesResource,
  ITransactionsResource,
  IUserInfoResource,
  IWebBotAuthResource,
} from '@/resources/interfaces';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { ReportResource } from '@/resources/report';
import { ShippingAddressResource } from '@/resources/shipping-address';
import { SourcesResource } from '@/resources/sources';
import { SpendRequestResource } from '@/resources/spend-request';
import { SpendingPolicyResource } from '@/resources/spending-policy';
import { SummariesResource } from '@/resources/summaries';
import { TransactionsResource } from '@/resources/transactions';
import { UserInfoResource } from '@/resources/user-info';
import { WebBotAuthResource } from '@/resources/web-bot-auth';

export class Link {
  readonly attestations: IAttestationsResource;
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;
  readonly shippingAddresses: IShippingAddressResource;
  readonly userInfo: IUserInfoResource;
  readonly spendingPolicy: ISpendingPolicyResource;
  readonly transactions: ITransactionsResource;
  readonly sources: ISourcesResource;
  readonly balances: IBalancesResource;
  readonly summaries: ISummariesResource;
  readonly webBotAuth: IWebBotAuthResource;
  readonly reports: IReportResource;

  constructor(options: LinkOptions) {
    this.attestations = new AttestationsResource(options);
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
    this.shippingAddresses = new ShippingAddressResource(options);
    this.userInfo = new UserInfoResource(options);
    this.spendingPolicy = new SpendingPolicyResource(options);
    this.transactions = new TransactionsResource(options);
    this.sources = new SourcesResource(options);
    this.balances = new BalancesResource(options);
    this.summaries = new SummariesResource(options);
    this.webBotAuth = new WebBotAuthResource(options);
    this.reports = new ReportResource(options);
  }
}

export default Link;
