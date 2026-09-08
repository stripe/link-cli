package link

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

type baseResource struct {
	config  resolvedConfig
	baseURL string
}

type apiResponse struct {
	status  int
	data    any
	rawBody string
}

func newBaseResource(config resolvedConfig, baseURL string) *baseResource {
	return &baseResource{config: config, baseURL: baseURL}
}

func (r *baseResource) fetch(ctx context.Context, method, url string, headers http.Header, body []byte) (apiResponse, error) {
	token, err := r.config.getAccessToken(ctx, GetAccessTokenOptions{})
	if err != nil {
		return apiResponse{}, err
	}
	response, err := r.rawFetch(ctx, method, url, headers, body, token)
	if err != nil {
		return apiResponse{}, err
	}
	if response.status == http.StatusUnauthorized && r.config.canRefresh {
		refreshedToken, refreshErr := r.config.getAccessToken(ctx, GetAccessTokenOptions{ForceRefresh: true})
		if refreshErr != nil {
			return apiResponse{}, refreshErr
		}
		return r.rawFetch(ctx, method, url, headers, body, refreshedToken)
	}
	return response, nil
}

func (r *baseResource) rawFetch(ctx context.Context, method, url string, headers http.Header, body []byte, token string) (apiResponse, error) {
	if r.config.verbose {
		r.config.logger.Debug(fmt.Sprintf("> %s %s", method, url))
	}
	request, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return apiResponse{}, newTransportError(fmt.Sprintf("Request failed: %s %s", method, url), err)
	}
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	for key, values := range r.config.defaultHeaders {
		if request.Header.Get(key) != "" {
			continue
		}
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}
	request.Header.Set("Authorization", "Bearer "+token)

	response, err := r.config.httpClient.Do(request)
	if err != nil {
		return apiResponse{}, newTransportError(fmt.Sprintf("Request failed: %s %s", method, url), err)
	}
	defer response.Body.Close()
	rawBody, err := io.ReadAll(response.Body)
	if err != nil {
		return apiResponse{}, newTransportError(fmt.Sprintf("Request failed: %s %s", method, url), err)
	}
	var data any
	if len(rawBody) > 0 {
		_ = json.Unmarshal(rawBody, &data)
	}
	if r.config.verbose {
		r.config.logger.Debug(fmt.Sprintf("< %d %s", response.StatusCode, http.StatusText(response.StatusCode)))
	}
	return apiResponse{status: response.StatusCode, data: data, rawBody: string(rawBody)}, nil
}

func (r *baseResource) doJSON(ctx context.Context, operation, method, url string, requestBody, target any) error {
	var body []byte
	var headers http.Header
	if requestBody != nil {
		encoded, err := json.Marshal(requestBody)
		if err != nil {
			return err
		}
		body = encoded
		headers = http.Header{"Content-Type": []string{"application/json"}}
	}
	response, err := r.fetch(ctx, method, url, headers, body)
	if err != nil {
		return err
	}
	if response.status < 200 || response.status >= 300 {
		return newAPIError(operation, response.status, response.data, response.rawBody)
	}
	return decodeResponse(operation, response, target)
}

func decodeResponse(operation string, response apiResponse, target any) error {
	body := bytes.TrimSpace([]byte(response.rawBody))
	if bytes.Equal(body, []byte("null")) {
		return newResponseError(operation, response.status, errors.New("response body is null"))
	}
	if err := json.Unmarshal(body, target); err != nil {
		return newResponseError(operation, response.status, err)
	}
	return nil
}
