package link

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"
)

const webBotAuthExpiryBuffer = 30 * time.Second

type webBotAuthCacheEntry struct {
	block     WebBotAuthBlock
	expiresAt time.Time
}

// WebBotAuthResource signs merchant URLs for Web Bot Auth.
type WebBotAuthResource struct {
	base  *baseResource
	mu    sync.RWMutex
	cache map[string]webBotAuthCacheEntry
	now   func() time.Time
}

func newWebBotAuthResource(base *baseResource) *WebBotAuthResource {
	return &WebBotAuthResource{
		base:  base,
		cache: make(map[string]webBotAuthCacheEntry),
		now:   time.Now,
	}
}

// SignURL returns signing material for the URL's authority. Fresh credentials
// are cached by hostname until 30 seconds before expiration.
func (r *WebBotAuthResource) SignURL(ctx context.Context, rawURL string) (*WebBotAuthBlock, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Hostname() == "" {
		if err == nil {
			err = fmt.Errorf("URL must be absolute")
		}
		return nil, newSDKError("Invalid URL: "+rawURL, err)
	}
	authority := parsed.Hostname()

	r.mu.RLock()
	cached, ok := r.cache[authority]
	r.mu.RUnlock()
	if ok && r.now().Before(cached.expiresAt.Add(-webBotAuthExpiryBuffer)) {
		block := cached.block
		return &block, nil
	}

	var envelope struct {
		WebBotAuth WebBotAuthBlock `json:"web_bot_auth"`
	}
	requestBody, err := json.Marshal(struct {
		URL string `json:"url"`
	}{URL: rawURL})
	if err != nil {
		return nil, err
	}
	response, err := r.base.fetch(
		ctx,
		http.MethodPost,
		r.base.baseURL+"/web_bot_auth/sign",
		http.Header{"Content-Type": []string{"application/json"}},
		requestBody,
	)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("get web bot auth headers", response.status, response.data, response.rawBody)
	}
	if err := decodeResponse("get web bot auth headers", response, &envelope); err != nil {
		return nil, err
	}
	block := envelope.WebBotAuth
	if block.Signature == "" || block.SignatureInput == "" || block.SignatureAgent == "" || block.Authority == "" || block.ExpiresAt == "" {
		return nil, newResponseError("get web bot auth headers", response.status, errors.New("response is missing required signing fields"))
	}
	expiresAt, err := time.Parse(time.RFC3339, block.ExpiresAt)
	if err != nil {
		return nil, newResponseError("get web bot auth headers", response.status, fmt.Errorf("invalid expires_at %q: %w", block.ExpiresAt, err))
	}
	r.mu.Lock()
	r.cache[authority] = webBotAuthCacheEntry{block: block, expiresAt: expiresAt}
	r.mu.Unlock()
	return &envelope.WebBotAuth, nil
}
