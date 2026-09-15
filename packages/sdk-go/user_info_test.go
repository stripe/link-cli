package link

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUserInfoPreservesStableID(t *testing.T) {
	for _, body := range []string{`{"id":"link_user_AbC123","email":"user@example.com"}`, `{}`} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/userinfo" || r.Header.Get("Authorization") != "Bearer token" {
					t.Errorf("unexpected userinfo request: %s", r.URL.Path)
				}
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
			assertNoError(t, err)
			info, err := client.UserInfo.Retrieve(context.Background())
			assertNoError(t, err)
			if body == `{}` {
				if info.ID != nil {
					t.Fatalf("missing ID became %q", *info.ID)
				}
			} else if info.ID == nil || *info.ID != "link_user_AbC123" {
				t.Fatalf("stable ID was not preserved: %+v", info)
			}
		})
	}
}
