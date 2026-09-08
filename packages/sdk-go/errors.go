package link

import (
	"encoding/json"
	"errors"
	"fmt"
)

// LinkError is implemented by every error created by the SDK. Use errors.As
// with this interface when handling all SDK errors by their stable code.
type LinkError interface {
	error
	ErrorCode() string
}

// LinkSDKError contains fields shared by SDK-created errors.
type LinkSDKError struct {
	Message string
	Code    string
	Cause   error
}

func (e *LinkSDKError) Error() string { return e.Message }
func (e *LinkSDKError) Unwrap() error { return e.Cause }
func (e *LinkSDKError) ErrorCode() string {
	return e.Code
}

// LinkConfigurationError reports invalid client configuration.
type LinkConfigurationError struct{ *LinkSDKError }

// LinkTransportError reports a failure to reach or read from Link.
type LinkTransportError struct{ *LinkSDKError }

// LinkResponseError reports a successful HTTP response with an invalid body.
type LinkResponseError struct {
	*LinkSDKError
	Status int
}

// LinkAPIError reports a non-success response from Link.
type LinkAPIError struct {
	*LinkSDKError
	Status  int
	RawBody string
	Details any
}

func newSDKError(message string, cause error) error {
	return &LinkSDKError{Message: message, Code: "sdk_error", Cause: cause}
}

func newConfigurationError(message string) error {
	return &LinkConfigurationError{&LinkSDKError{Message: message, Code: "configuration_error"}}
}

func newTransportError(message string, cause error) error {
	return &LinkTransportError{&LinkSDKError{Message: message, Code: "transport_error", Cause: cause}}
}

func newResponseError(operation string, status int, cause error) error {
	message := fmt.Sprintf("Invalid response while attempting to %s (%d)", operation, status)
	if cause != nil {
		message += ": " + cause.Error()
	}
	return &LinkResponseError{
		LinkSDKError: &LinkSDKError{Message: message, Code: "invalid_response", Cause: cause},
		Status:       status,
	}
}

func newAPIError(operation string, status int, data any, rawBody string) error {
	message := extractErrorMessage(data, rawBody)
	return &LinkAPIError{
		LinkSDKError: &LinkSDKError{
			Message: fmt.Sprintf("Failed to %s (%d): %s", operation, status, message),
			Code:    "api_error",
		},
		Status:  status,
		RawBody: rawBody,
		Details: data,
	}
}

func extractErrorMessage(data any, rawBody string) string {
	if record, ok := data.(map[string]any); ok {
		if value, ok := record["error"].(string); ok {
			return value
		}
		if nested, ok := record["error"].(map[string]any); ok {
			if value, ok := nested["message"].(string); ok {
				return value
			}
			if value, ok := nested["code"].(string); ok {
				return value
			}
		}
		if value, ok := record["message"].(string); ok {
			return value
		}
	}
	if rawBody != "" {
		return rawBody
	}
	return "unknown error"
}

// GetDuplicateSpendRequest returns the duplicate included in an API error, if any.
func GetDuplicateSpendRequest(err error) *SpendRequest {
	var apiError *LinkAPIError
	if !errors.As(err, &apiError) {
		return nil
	}
	record, ok := apiError.Details.(map[string]any)
	if !ok {
		return nil
	}
	errorRecord, ok := record["error"].(map[string]any)
	if !ok {
		return nil
	}
	duplicate, ok := errorRecord["duplicate_spend_request"]
	if !ok {
		return nil
	}
	data, marshalErr := json.Marshal(duplicate)
	if marshalErr != nil {
		return nil
	}
	var spendRequest SpendRequest
	if unmarshalErr := json.Unmarshal(data, &spendRequest); unmarshalErr != nil || spendRequest.ID == "" || spendRequest.Status == "" || spendRequest.CreatedAt == "" || spendRequest.UpdatedAt == "" {
		return nil
	}
	return &spendRequest
}
