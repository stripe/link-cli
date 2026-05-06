import type { LinkOptions } from '@/config';
import type {
  IPaymentMethodsResource,
  IShippingAddressResource,
  ISpendRequestResource,
} from '@/resources/interfaces';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { ShippingAddressResource } from '@/resources/shipping-address';
import { SpendRequestResource } from '@/resources/spend-request';

export class Link {
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;
  readonly shippingAddresses: IShippingAddressResource;

  constructor(options: LinkOptions = {}) {
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
    this.shippingAddresses = new ShippingAddressResource(options);
  }
}

export { Link as LinkClient };
export default Link;
