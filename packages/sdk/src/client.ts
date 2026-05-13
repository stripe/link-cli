import type { LinkOptions } from '@/config';
import type {
  IPaymentMethodsResource,
  IShippingAddressResource,
  ISpendRequestResource,
  IUserInfoResource,
  IWebBotAuthResource,
} from '@/resources/interfaces';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { ShippingAddressResource } from '@/resources/shipping-address';
import { SpendRequestResource } from '@/resources/spend-request';
import { UserInfoResource } from '@/resources/user-info';
import { WebBotAuthResource } from '@/resources/web-bot-auth';

export class Link {
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;
  readonly shippingAddresses: IShippingAddressResource;
  readonly userInfo: IUserInfoResource;
  readonly webBotAuth: IWebBotAuthResource;

  constructor(options: LinkOptions = {}) {
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
    this.shippingAddresses = new ShippingAddressResource(options);
    this.userInfo = new UserInfoResource(options);
    this.webBotAuth = new WebBotAuthResource(options);
  }
}

export { Link as LinkClient };
export default Link;
