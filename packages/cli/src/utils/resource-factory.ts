import {
  type AccessTokenProvider,
  type IBalancesResource,
  type IPaymentMethodsResource,
  type IReportResource,
  type IShippingAddressResource,
  type ISourcesResource,
  type ISpendRequestResource,
  type ITransactionsResource,
  type IUserInfoResource,
  type IWebBotAuthResource,
  default as Link,
  LinkConfigurationError,
  type LinkOptions,
} from '@stripe/link-sdk';
import { LinkAuthResource } from '../auth/auth-resource';
import { LinkAuthenticationError } from '../auth/errors';
import { createAccessTokenProvider } from '../auth/session';
import type { CliAuthStorage } from '../auth/storage';
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
  authStorage?: CliAuthStorage;
  envAccessToken?: string;
  envRefreshToken?: string;
  noRefresh?: boolean;
  authResource?: IAuthResource;
  apiBaseUrl?: string;
  spendRequestBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

function createProxyFetch(
  baseFetch: typeof globalThis.fetch,
  proxyUrl: string,
): typeof globalThis.fetch {
  let dispatcherPromise: Promise<unknown> | null = null;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const moduleName = 'undici';
    dispatcherPromise ??= (
      import(moduleName) as Promise<{
        ProxyAgent: new (url: string) => unknown;
      }>
    )
      .then(({ ProxyAgent }) => new ProxyAgent(proxyUrl))
      .catch((error) => {
        throw new LinkConfigurationError(
          'LINK_HTTP_PROXY requires the "undici" package. Install it with: npm install undici',
          { cause: error },
        );
      });
    return dispatcherPromise.then((dispatcher) =>
      baseFetch(input, { ...init, dispatcher } as RequestInit),
    );
  }) as typeof globalThis.fetch;
}

export class ResourceFactory {
  private readonly verbose: boolean;
  private readonly defaultHeaders?: Record<string, string>;
  private readonly authStorage?: CliAuthStorage;
  private readonly envAccessToken?: string;
  private readonly envRefreshToken?: string;
  private readonly noRefresh: boolean;
  private readonly apiBaseUrl?: string;
  private readonly spendRequestBaseUrl?: string;
  private readonly fetch?: typeof globalThis.fetch;
  private _authResource?: IAuthResource;
  private accessTokenProvider?: ReturnType<typeof createAccessTokenProvider>;
  private sdkClient?: Link;
  private spendRequestResource?: ISpendRequestResource;
  private paymentMethodsResource?: IPaymentMethodsResource;
  private shippingAddressResource?: IShippingAddressResource;
  private userInfoResource?: IUserInfoResource;
  private transactionsResource?: ITransactionsResource;
  private sourcesResource?: ISourcesResource;
  private balancesResource?: IBalancesResource;
  private webBotAuthResource?: IWebBotAuthResource;
  private reportResource?: IReportResource;

  constructor(options: ResourceFactoryOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.defaultHeaders = options.defaultHeaders;
    this.authStorage = options.authStorage;
    this.envAccessToken = options.envAccessToken;
    this.envRefreshToken = options.envRefreshToken;
    this.noRefresh = options.noRefresh ?? false;
    this.apiBaseUrl = options.apiBaseUrl ?? process.env.LINK_API_BASE_URL;
    this.spendRequestBaseUrl = options.spendRequestBaseUrl ?? this.apiBaseUrl;
    const proxyUrl = process.env.LINK_HTTP_PROXY;
    this.fetch =
      options.fetch ??
      (proxyUrl ? createProxyFetch(globalThis.fetch, proxyUrl) : undefined);
    this._authResource = options.authResource;
  }

  private createSdkOptions(getAccessToken: AccessTokenProvider): LinkOptions {
    return {
      verbose: this.verbose,
      defaultHeaders: this.defaultHeaders,
      getAccessToken,
      apiBaseUrl: this.apiBaseUrl,
      spendRequestBaseUrl: this.spendRequestBaseUrl,
      fetch: this.fetch,
      logger: this.verbose
        ? {
            debug(message: string) {
              process.stderr.write(
                message.endsWith('\n') ? message : `${message}\n`,
              );
            },
          }
        : undefined,
    };
  }

  createAuthResource(): IAuthResource {
    if (this._authResource) {
      return this._authResource;
    }

    this._authResource = sanitizeResource(
      new LinkAuthResource({
        verbose: this.verbose,
        defaultHeaders: this.defaultHeaders,
      }),
    );

    return this._authResource;
  }

  getAuthStorage(): CliAuthStorage | undefined {
    return this.authStorage;
  }

  getAccessTokenProvider(): ReturnType<typeof createAccessTokenProvider> {
    return this.createSdkAccessTokenProvider();
  }

  private createSdkAccessTokenProvider() {
    if (this.accessTokenProvider) {
      return this.accessTokenProvider;
    }

    if (this.envAccessToken) {
      const envAccessToken = this.envAccessToken;
      const envRefreshToken = this.envRefreshToken;
      const noRefresh = this.noRefresh;

      this.accessTokenProvider = async ({ forceRefresh } = {}) => {
        if (forceRefresh) {
          if (noRefresh || !envRefreshToken) {
            throw new LinkAuthenticationError(
              'Access token expired. Update LINK_ACCESS_TOKEN and retry.',
            );
          }
          const refreshed =
            await this.createAuthResource().refreshToken(envRefreshToken);
          return refreshed.access_token;
        }
        return envAccessToken;
      };
      return this.accessTokenProvider;
    }

    this.accessTokenProvider = createAccessTokenProvider(
      this.createAuthResource(),
      this.authStorage,
      { noRefresh: this.noRefresh },
    );
    return this.accessTokenProvider;
  }

  private createSdkClient(): Link {
    if (!this.sdkClient) {
      this.sdkClient = new Link(
        this.createSdkOptions(this.createSdkAccessTokenProvider()),
      );
    }
    return this.sdkClient;
  }

  createSpendRequestResource(): ISpendRequestResource {
    if (this.spendRequestResource) {
      return this.spendRequestResource;
    }

    this.spendRequestResource = sanitizeResource(
      this.createSdkClient().spendRequests,
    );

    return this.spendRequestResource;
  }

  createPaymentMethodsResource(): IPaymentMethodsResource {
    if (this.paymentMethodsResource) {
      return this.paymentMethodsResource;
    }

    this.paymentMethodsResource = sanitizeResource(
      this.createSdkClient().paymentMethods,
    );

    return this.paymentMethodsResource;
  }

  createShippingAddressResource(): IShippingAddressResource {
    if (this.shippingAddressResource) {
      return this.shippingAddressResource;
    }

    this.shippingAddressResource = sanitizeResource(
      this.createSdkClient().shippingAddresses,
    );

    return this.shippingAddressResource;
  }

  createUserInfoResource(): IUserInfoResource {
    if (this.userInfoResource) {
      return this.userInfoResource;
    }

    this.userInfoResource = sanitizeResource(this.createSdkClient().userInfo);

    return this.userInfoResource;
  }

  createTransactionsResource(): ITransactionsResource {
    if (this.transactionsResource) {
      return this.transactionsResource;
    }

    this.transactionsResource = sanitizeResource(
      this.createSdkClient().transactions,
    );

    return this.transactionsResource;
  }

  createSourcesResource(): ISourcesResource {
    if (this.sourcesResource) {
      return this.sourcesResource;
    }

    this.sourcesResource = sanitizeResource(this.createSdkClient().sources);

    return this.sourcesResource;
  }

  createBalancesResource(): IBalancesResource {
    if (this.balancesResource) {
      return this.balancesResource;
    }

    this.balancesResource = sanitizeResource(this.createSdkClient().balances);

    return this.balancesResource;
  }

  createWebBotAuthResource(): IWebBotAuthResource {
    if (this.webBotAuthResource) {
      return this.webBotAuthResource;
    }

    this.webBotAuthResource = sanitizeResource(
      this.createSdkClient().webBotAuth,
    );

    return this.webBotAuthResource;
  }

  createReportResource(): IReportResource {
    if (this.reportResource) {
      return this.reportResource;
    }

    this.reportResource = sanitizeResource(this.createSdkClient().reports);

    return this.reportResource;
  }
}
