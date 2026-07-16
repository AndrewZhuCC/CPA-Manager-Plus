package proxy

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestIsManagementPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/v0/management", want: true},
		{path: "/v0/management/", want: true},
		{path: "/v0/management/auth-files", want: true},
		{path: "/v0/management/auth-files/status", want: true},
		{path: "/v0/management/api-call", want: true},
		{path: "/v0/management/api-key-usage", want: true},
		{path: "/v0/resource/plugins", want: true},
		{path: "/v0/resource/plugins/codex-invite/invite", want: true},
		{path: "/v0/resource/plugin", want: false},
		{path: "/v0/resource/plugin-store", want: false},
		{path: "/v1/models", want: false},
		{path: "/models", want: false},
		{path: "/auth-files", want: false},
		{path: "/api-call", want: false},
		{path: "/", want: false},
		{path: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := isManagementPath(tt.path); got != tt.want {
				t.Fatalf("isManagementPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestIsModelListPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/v1/models", want: true},
		{path: "/v1/models/", want: true},
		{path: "/models", want: true},
		{path: "/models/", want: true},
		{path: "/v1/chat/completions", want: false},
		{path: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := isModelListPath(tt.path); got != tt.want {
				t.Fatalf("isModelListPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestIsCPAPluginManagementPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/v0/management/codex-invite/accounts", want: true},
		{path: "/v0/management/sample-plugin/custom/action", want: true},
		{path: "/v0/management/accounts", want: false},
		{path: "/v0/management/accounts/", want: false},
		{path: "/v0/management/config", want: false},
		{path: "/v0/management/reload", want: false},
		{path: "/v0/management/plugins/demo/custom", want: false},
		{path: "/v0/management/plugin-store/demo/install", want: false},
		{path: "/v0/management/usage", want: false},
		{path: "/v0/resource/plugins/codex-invite/invite", want: false},
		{path: "/v0/management", want: false},
		{path: "/v0/management/", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := IsCPAPluginManagementPath(tt.path); got != tt.want {
				t.Fatalf("IsCPAPluginManagementPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestIsCPAPluginResourcePath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{path: "/v0/resource/plugins", want: true},
		{path: "/v0/resource/plugins/", want: true},
		{path: "/v0/resource/plugins/codex-invite/invite", want: true},
		{path: "/v0/resource/plugins/codex-invite/assets/app.js", want: true},
		{path: "/v0/resource/plugin", want: false},
		{path: "/v0/resource/plugin-store", want: false},
		{path: "/plugins/codex-invite/invite", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := IsCPAPluginResourcePath(tt.path); got != tt.want {
				t.Fatalf("IsCPAPluginResourcePath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestRewriteCodexInviteOrigin(t *testing.T) {
	target, err := url.Parse("http://cpa.local:8317/base")
	if err != nil {
		t.Fatalf("parse target: %v", err)
	}

	header := http.Header{}
	header.Set(codexInviteOriginHeader, "http://manager.local:18317")
	header.Set("Origin", "http://manager.local:18317")

	rewriteCodexInviteOrigin(header, target)

	if got := header.Get(codexInviteOriginHeader); got != "http://cpa.local:8317" {
		t.Fatalf("%s = %q", codexInviteOriginHeader, got)
	}
	if got := header.Get("Origin"); got != "http://manager.local:18317" {
		t.Fatalf("Origin = %q", got)
	}

	emptyHeader := http.Header{}
	rewriteCodexInviteOrigin(emptyHeader, target)
	if got := emptyHeader.Get(codexInviteOriginHeader); got != "" {
		t.Fatalf("empty %s = %q", codexInviteOriginHeader, got)
	}
}

func TestRewritePluginManagementOriginBody(t *testing.T) {
	target, err := url.Parse("http://cpa.local:8317")
	if err != nil {
		t.Fatalf("parse target: %v", err)
	}

	req, err := http.NewRequest(
		http.MethodPost,
		"/v0/management/codex-invite/invite",
		strings.NewReader(`{"management_origin":"http://manager.local:18317","refresh":true}`),
	)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if err := rewritePluginManagementOriginBody(req, target); err != nil {
		t.Fatalf("rewritePluginManagementOriginBody() error = %v", err)
	}
	raw, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	want := `{"management_origin":"http://cpa.local:8317","refresh":true}`
	if string(raw) != want {
		t.Fatalf("body = %q, want %q", raw, want)
	}
	if req.ContentLength != int64(len(want)) {
		t.Fatalf("content length = %d, want %d", req.ContentLength, len(want))
	}
}

func TestRewritePluginManagementOriginBodyLeavesOtherBodies(t *testing.T) {
	target, err := url.Parse("http://cpa.local:8317")
	if err != nil {
		t.Fatalf("parse target: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, "/v0/resource/plugins/demo", strings.NewReader(`{"refresh":true}`))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	if err := rewritePluginManagementOriginBody(req, target); err != nil {
		t.Fatalf("rewritePluginManagementOriginBody() error = %v", err)
	}
	raw, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(raw) != `{"refresh":true}` {
		t.Fatalf("body = %q", raw)
	}
}

func TestShouldEnrichAuthFilesResponse(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, authFilesManagementPath+"?page=1", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if !shouldEnrichAuthFilesResponse(req, "/auth-files") {
		t.Fatal("auth files GET should be enriched")
	}
	req.Method = http.MethodPost
	if shouldEnrichAuthFilesResponse(req, "/auth-files") {
		t.Fatal("auth files POST should not be enriched")
	}
	req.Method = http.MethodGet
	if shouldEnrichAuthFilesResponse(req, "") {
		t.Fatal("request without an auth file directory should not be enriched")
	}
}

func TestEnrichAuthFilesResponseAddsStableFileCreationTime(t *testing.T) {
	createdAt := time.Date(2026, time.July, 15, 8, 9, 10, 123456789, time.FixedZone("UTC+8", 8*60*60))
	svc := &Service{
		authFileDir: "/auth-files",
		authFileCreatedAt: func(path string) (time.Time, error) {
			if path != "/auth-files/codex.json" {
				t.Fatalf("creation time path = %q", path)
			}
			return createdAt, nil
		},
	}
	body := `{"files":[{"name":"codex.json","auth_index":9007199254740993}],"total":1}`
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header: http.Header{
			"Content-Type":   []string{"application/json"},
			"Content-Length": []string{strconv.Itoa(len(body))},
			"ETag":           []string{`"upstream"`},
		},
		Body:          io.NopCloser(strings.NewReader(body)),
		ContentLength: int64(len(body)),
	}

	if err := svc.enrichAuthFilesResponse(resp); err != nil {
		t.Fatalf("enrichAuthFilesResponse() error = %v", err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	var payload struct {
		Files []map[string]json.RawMessage `json:"files"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := string(payload.Files[0][fileCreatedAtJSONField]); got != `"2026-07-15T00:09:10.123456789Z"` {
		t.Fatalf("file_created_at = %s", got)
	}
	if got := string(payload.Files[0]["auth_index"]); got != "9007199254740993" {
		t.Fatalf("auth_index changed during enrichment: %s", got)
	}
	if resp.ContentLength != int64(len(raw)) || resp.Header.Get("Content-Length") != strconv.Itoa(len(raw)) {
		t.Fatalf("content length = %d / %q, body = %d", resp.ContentLength, resp.Header.Get("Content-Length"), len(raw))
	}
	if got := resp.Header.Get("ETag"); got != "" {
		t.Fatalf("ETag = %q", got)
	}
}

func TestSafeAuthFilePathRejectsTraversal(t *testing.T) {
	if path, ok := safeAuthFilePath("/auth-files", "codex.json"); !ok || path != "/auth-files/codex.json" {
		t.Fatalf("safe path = %q, %v", path, ok)
	}
	for _, name := range []string{"../secret.json", `..\\secret.json`, "/secret.json", ".."} {
		if path, ok := safeAuthFilePath("/auth-files", name); ok {
			t.Fatalf("safeAuthFilePath(%q) = %q, true", name, path)
		}
	}
}

func TestReadFileBirthTimeForNewFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credential.json")
	if err := os.WriteFile(path, []byte(`{"type":"codex"}`), 0o600); err != nil {
		t.Fatalf("write auth file: %v", err)
	}
	createdAt, err := readFileBirthTime(path)
	if err != nil {
		t.Skipf("file system does not expose birth time: %v", err)
	}
	if createdAt.IsZero() {
		t.Fatal("file birth time is zero")
	}
}
