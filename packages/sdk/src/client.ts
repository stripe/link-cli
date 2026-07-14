import type { LinkOptions } from '@/config';
import type {
  IBalancesResource,
  IPaymentMethodsResource,
  IShippingAddressResource,
  ISourcesResource,
  ISpendRequestResource,
  ITransactionsResource,
  IUserInfoResource,
} from '@/resources/interfaces';
import { BalancesResource } from '@/resources/balances';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { ShippingAddressResource } from '@/resources/shipping-address';
import { SourcesResource } from '@/resources/sources';
import { SpendRequestResource } from '@/resources/spend-request';
import { TransactionsResource } from '@/resources/transactions';
import { UserInfoResource } from '@/resources/user-info';

export class Link {
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;
  readonly shippingAddresses: IShippingAddressResource;
  readonly userInfo: IUserInfoResource;
  readonly transactions: ITransactionsResource;
  readonly sources: ISourcesResource;
  readonly balances: IBalancesResource;

  constructor(options: LinkOptions = {}) {
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
    this.shippingAddresses = new ShippingAddressResource(options);
    this.userInfo = new UserInfoResource(options);
    this.transactions = new TransactionsResource(options);
    this.sources = new SourcesResource(options);
    this.balances = new BalancesResource(options);
  }
}

export { Link as LinkClient };
export default Link;
