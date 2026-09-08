package link

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

const defaultAPIBaseURL = "https://api.link.com"

// AccessTokenProvider returns an access token for a request. Providers should
// coalesce concurrent refreshes when ForceRefresh is true.
type AccessTokenProvider func(context.Context, GetAccessTokenOptions) (string, error)

// HTTPClient is the subset of http.Client used by the SDK.
type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Logger receives transport diagnostics when Options.Verbose is enabled.
type Logger interface {
	Debug(string)
}

// Options configures a Client. Exactly one of AccessToken and GetAccessToken
// must be provided.
type Options struct {
	AccessToken         string
	GetAccessToken      AccessTokenProvider
	HTTPClient          HTTPClient
	DefaultHeaders      http.Header
	Verbose             bool
	APIBaseURL          string
	SpendRequestBaseURL string
	Logger              Logger
}

// Client provides typed access to Link API resources. A Client is safe for
// concurrent use when its HTTPClient, Logger, and token provider are safe.
type Client struct {
	SpendRequests     *SpendRequestsResource
	PaymentMethods    *PaymentMethodsResource
	ShippingAddresses *ShippingAddressesResource
	UserInfo          *UserInfoResource
	Transactions      *TransactionsResource
	Sources           *SourcesResource
	Balances          *BalancesResource
	WebBotAuth        *WebBotAuthResource
	Reports           *ReportsResource
}

type resolvedConfig struct {
	getAccessToken      AccessTokenProvider
	canRefresh          bool
	httpClient          HTTPClient
	defaultHeaders      http.Header
	verbose             bool
	apiBaseURL          string
	spendRequestBaseURL string
	logger              Logger
}

type noopLogger struct{}

func (noopLogger) Debug(string) {}

// NewClient constructs a Link API client.
func NewClient(options Options) (*Client, error) {
	config, err := resolveConfig(options)
	if err != nil {
		return nil, err
	}

	api := newBaseResource(config, config.apiBaseURL)
	spend := newBaseResource(config, config.spendRequestBaseURL)
	return &Client{
		SpendRequests:     &SpendRequestsResource{base: spend},
		PaymentMethods:    &PaymentMethodsResource{base: api},
		ShippingAddresses: &ShippingAddressesResource{base: api},
		UserInfo:          &UserInfoResource{base: api},
		Transactions:      &TransactionsResource{base: api},
		Sources:           &SourcesResource{base: api},
		Balances:          &BalancesResource{base: api},
		WebBotAuth:        newWebBotAuthResource(api),
		Reports:           &ReportsResource{base: api},
	}, nil
}

func resolveConfig(options Options) (resolvedConfig, error) {
	hasAccessToken := options.AccessToken != ""
	hasProvider := options.GetAccessToken != nil
	if hasAccessToken && hasProvider {
		return resolvedConfig{}, newConfigurationError("Pass either `AccessToken` or `GetAccessToken`, not both.")
	}

	var getAccessToken AccessTokenProvider
	var canRefresh bool
	if hasAccessToken {
		if strings.TrimSpace(options.AccessToken) == "" {
			return resolvedConfig{}, newConfigurationError("`AccessToken` cannot be empty.")
		}
		accessToken := options.AccessToken
		getAccessToken = func(context.Context, GetAccessTokenOptions) (string, error) {
			return accessToken, nil
		}
	} else if hasProvider {
		getAccessToken = options.GetAccessToken
		canRefresh = true
	} else {
		return resolvedConfig{}, newConfigurationError("Pass `AccessToken` or `GetAccessToken` to the Link client.")
	}

	apiBaseURL := options.APIBaseURL
	if apiBaseURL == "" {
		apiBaseURL = defaultAPIBaseURL
	}
	apiBaseURL, err := normalizeBaseURL("APIBaseURL", apiBaseURL)
	if err != nil {
		return resolvedConfig{}, err
	}
	spendRequestBaseURL := options.SpendRequestBaseURL
	if spendRequestBaseURL == "" {
		spendRequestBaseURL = apiBaseURL
	}
	spendRequestBaseURL, err = normalizeBaseURL("SpendRequestBaseURL", spendRequestBaseURL)
	if err != nil {
		return resolvedConfig{}, err
	}
	logger := options.Logger
	if logger == nil {
		logger = noopLogger{}
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	return resolvedConfig{
		getAccessToken:      getAccessToken,
		canRefresh:          canRefresh,
		httpClient:          httpClient,
		defaultHeaders:      options.DefaultHeaders.Clone(),
		verbose:             options.Verbose,
		apiBaseURL:          apiBaseURL,
		spendRequestBaseURL: spendRequestBaseURL,
		logger:              logger,
	}, nil
}

func normalizeBaseURL(optionName, value string) (string, error) {
	normalized := strings.TrimRight(value, "/")
	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", newConfigurationError("`" + optionName + "` must be an absolute HTTP(S) URL without a query or fragment.")
	}
	return normalized, nil
}
