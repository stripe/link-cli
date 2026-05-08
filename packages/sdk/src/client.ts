import type { LinkOptions } from '@/config';
import type {
  IPaymentMethodsResource,
  IReportResource,
  IShippingAddressResource,
  ISpendRequestResource,
  IUserInfoResource,
} from '@/resources/interfaces';
import { PaymentMethodsResource } from '@/resources/payment-methods';
import { ReportResource } from '@/resources/report';
import { ShippingAddressResource } from '@/resources/shipping-address';
import { SpendRequestResource } from '@/resources/spend-request';
import { UserInfoResource } from '@/resources/user-info';

export class Link {
  readonly spendRequests: ISpendRequestResource;
  readonly paymentMethods: IPaymentMethodsResource;
  readonly shippingAddresses: IShippingAddressResource;
  readonly userInfo: IUserInfoResource;
  readonly reports: IReportResource;

  constructor(options: LinkOptions = {}) {
    this.spendRequests = new SpendRequestResource(options);
    this.paymentMethods = new PaymentMethodsResource(options);
    this.shippingAddresses = new ShippingAddressResource(options);
    this.userInfo = new UserInfoResource(options);
    this.reports = new ReportResource(options);
  }
}

export { Link as LinkClient };
export default Link;
