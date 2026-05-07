import {
  type AuthStorage,
  type IPaymentMethodsResource,
  type IShippingAddressResource,
  type ISpendRequestResource,
  type IUserInfoResource,
  PaymentMethodsResource,
  ShippingAddressResource,
  SpendRequestResource,
  UserInfoResource,
} from '@stripe/link-sdk';
import { LinkAuthResource } from '../auth/auth-resource';
import { createAccessTokenProvider } from '../auth/session';
import type { IAuthResource } from '../auth/types';
import { sanitizeDeep } from './sanitize-text';

/**
 * Wraps an SDK resource with a Proxy that strips ANSI escape sequences and
 * control characters from all string values in async method return values.
 *
 * This is the single sanitization boundary for all server data entering the CLI.
 * It protects against terminal escape injection regardless of output format
 * (interactive Ink rendering, toon, yaml, md, JSON) because sanitization happens
 * before data reaches either the React components or the incur formatter.
 *
 * Non-function properties and synchronous return values pass through unchanged.
 * Only Promise-returning methods (i.e. all SDK API calls) have their resolved
 * values recursively sanitized via sanitizeDeep.
 */
export function sanitizeResource<T extends object>(resource: T): T {
  return new Proxy(resource, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Non-function properties (e.g. config fields) pass through as-is.
      if (typeof value !== 'function') {
        return value;
      }

      // Wrap each method call. If the method returns a Promise (all SDK API
      // methods do), pipe its resolved value through sanitizeDeep to strip
      // escape sequences from every string field in the response object.
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result && typeof result.then === 'function') {
          return result.then(sanitizeDeep);
        }
        return result;
      };
    },
  });
}

interface ResourceFactoryOptions {
  verbose?: boolean;
  defaultHeaders?: Record<string, string>;
  authStorage?: AuthStorage;
}

export class ResourceFactory {
  private readonly verbose: boolean;
  private readonly defaultHeaders?: Record<string, string>;
  private readonly authStorage?: AuthStorage;
  private authResource?: IAuthResource;
  private accessTokenProvider?: ReturnType<typeof createAccessTokenProvider>;
  private spendRequestResource?: ISpendRequestResource;
  private paymentMethodsResource?: IPaymentMethodsResource;
  private shippingAddressResource?: IShippingAddressResource;
  private userInfoResource?: IUserInfoResource;

  constructor(options: ResourceFactoryOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.defaultHeaders = options.defaultHeaders;
    this.authStorage = options.authStorage;
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

  getAuthStorage(): AuthStorage | undefined {
    return this.authStorage;
  }

  private createSdkAccessTokenProvider() {
    if (this.accessTokenProvider) {
      return this.accessTokenProvider;
    }

    this.accessTokenProvider = createAccessTokenProvider(
      this.createAuthResource(),
      this.authStorage,
    );
    return this.accessTokenProvider;
  }

  createSpendRequestResource(): ISpendRequestResource {
    if (this.spendRequestResource) {
      return this.spendRequestResource;
    }

    const getAccessToken = this.createSdkAccessTokenProvider();
    this.spendRequestResource = sanitizeResource(
      new SpendRequestResource({
        verbose: this.verbose,
        defaultHeaders: this.defaultHeaders,
        getAccessToken,
      }),
    );

    return this.spendRequestResource;
  }

  createPaymentMethodsResource(): IPaymentMethodsResource {
    if (this.paymentMethodsResource) {
      return this.paymentMethodsResource;
    }

    const getAccessToken = this.createSdkAccessTokenProvider();
    this.paymentMethodsResource = sanitizeResource(
      new PaymentMethodsResource({
        verbose: this.verbose,
        defaultHeaders: this.defaultHeaders,
        getAccessToken,
      }),
    );

    return this.paymentMethodsResource;
  }

  createShippingAddressResource(): IShippingAddressResource {
    if (this.shippingAddressResource) {
      return this.shippingAddressResource;
    }

    const getAccessToken = this.createSdkAccessTokenProvider();
    this.shippingAddressResource = sanitizeResource(
      new ShippingAddressResource({
        verbose: this.verbose,
        defaultHeaders: this.defaultHeaders,
        getAccessToken,
      }),
    );

    return this.shippingAddressResource;
  }

  createUserInfoResource(): IUserInfoResource {
    if (this.userInfoResource) {
      return this.userInfoResource;
    }

    const getAccessToken = this.createSdkAccessTokenProvider();
    this.userInfoResource = sanitizeResource(
      new UserInfoResource({
        verbose: this.verbose,
        defaultHeaders: this.defaultHeaders,
        getAccessToken,
      }),
    );

    return this.userInfoResource;
  }
}
