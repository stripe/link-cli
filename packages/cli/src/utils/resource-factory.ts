import {
  type IPaymentMethodsResource,
  type ISpendRequestResource,
  PaymentMethodsResource,
  SpendRequestResource,
} from '@stripe/link-sdk';
import { LinkAuthResource } from '../auth/auth-resource';
import { createAccessTokenProvider } from '../auth/session';
import type { IAuthResource } from '../auth/types';

interface ResourceFactoryOptions {
  verbose?: boolean;
  defaultHeaders?: Record<string, string>;
}

export class ResourceFactory {
  private readonly verbose: boolean;
  private readonly defaultHeaders?: Record<string, string>;
  private authResource?: IAuthResource;
  private accessTokenProvider?: ReturnType<typeof createAccessTokenProvider>;
  private spendRequestResource?: ISpendRequestResource;
  private paymentMethodsResource?: IPaymentMethodsResource;

  constructor(options: ResourceFactoryOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.defaultHeaders = options.defaultHeaders;
  }

  createAuthResource(): IAuthResource {
    if (this.authResource) {
      return this.authResource;
    }

    this.authResource = new LinkAuthResource({
      verbose: this.verbose,
      defaultHeaders: this.defaultHeaders,
    });

    return this.authResource;
  }

  private createSdkAccessTokenProvider() {
    if (this.accessTokenProvider) {
      return this.accessTokenProvider;
    }

    this.accessTokenProvider = createAccessTokenProvider(
      this.createAuthResource(),
    );
    return this.accessTokenProvider;
  }

  createSpendRequestResource(): ISpendRequestResource {
    if (this.spendRequestResource) {
      return this.spendRequestResource;
    }

    const getAccessToken = this.createSdkAccessTokenProvider();
    this.spendRequestResource = new SpendRequestResource({
      verbose: this.verbose,
      defaultHeaders: this.defaultHeaders,
      getAccessToken,
    });

    return this.spendRequestResource;
  }

  createPaymentMethodsResource(): IPaymentMethodsResource {
    if (this.paymentMethodsResource) {
      return this.paymentMethodsResource;
    }

    const getAccessToken = this.createSdkAccessTokenProvider();
    this.paymentMethodsResource = new PaymentMethodsResource({
      verbose: this.verbose,
      defaultHeaders: this.defaultHeaders,
      getAccessToken,
    });

    return this.paymentMethodsResource;
  }
}
