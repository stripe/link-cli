import type { LinkOptions } from '@/config';
import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@/resources/interfaces';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { SpendRequestResource } from '@/resources/spend-request';

export class Link {
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;

  constructor(options: LinkOptions = {}) {
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
  }
}

export { Link as LinkClient };
export default Link;
