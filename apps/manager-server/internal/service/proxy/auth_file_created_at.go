package proxy

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const authFilesManagementPath = "/v0/management/auth-files"
const fileCreatedAtJSONField = "file_created_at"

type authFileCreationTimeResolver func(path string) (time.Time, error)

func shouldEnrichAuthFilesResponse(r *http.Request, authFileDir string) bool {
	if r == nil || strings.TrimSpace(authFileDir) == "" || r.Method != http.MethodGet {
		return false
	}
	return strings.TrimRight(r.URL.Path, "/") == authFilesManagementPath
}

func (s *Service) enrichAuthFilesResponse(resp *http.Response) error {
	if resp == nil || resp.Body == nil || s.authFileCreatedAt == nil ||
		resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil
	}
	contentEncoding := strings.TrimSpace(resp.Header.Get("Content-Encoding"))
	if (contentEncoding != "" && !strings.EqualFold(contentEncoding, "identity")) ||
		!isJSONContentType(resp.Header.Get("Content-Type")) {
		return nil
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if err := resp.Body.Close(); err != nil {
		return err
	}
	restoreResponseBody(resp, raw)

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	var files []map[string]json.RawMessage
	if err := json.Unmarshal(payload["files"], &files); err != nil {
		return nil
	}

	changed := false
	for _, entry := range files {
		var name string
		if err := json.Unmarshal(entry["name"], &name); err != nil {
			continue
		}
		path, ok := safeAuthFilePath(s.authFileDir, name)
		if !ok {
			continue
		}
		createdAt, err := s.authFileCreatedAt(path)
		if err != nil || createdAt.IsZero() {
			continue
		}
		encoded, err := json.Marshal(createdAt.UTC().Format(time.RFC3339Nano))
		if err != nil {
			continue
		}
		entry[fileCreatedAtJSONField] = encoded
		changed = true
	}
	if !changed {
		return nil
	}

	encodedFiles, err := json.Marshal(files)
	if err != nil {
		return err
	}
	payload["files"] = encodedFiles
	next, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	restoreResponseBody(resp, next)
	resp.Header.Del("ETag")
	return nil
}

func safeAuthFilePath(dir string, name string) (string, bool) {
	if dir == "" || name == "" || filepath.IsAbs(name) || strings.ContainsAny(name, `/\\`) {
		return "", false
	}
	if name != filepath.Base(name) || name == "." || name == ".." {
		return "", false
	}
	return filepath.Join(dir, name), true
}

func restoreResponseBody(resp *http.Response, body []byte) {
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	if resp.Header == nil {
		resp.Header = make(http.Header)
	}
	resp.Header.Set("Content-Length", strconv.FormatInt(int64(len(body)), 10))
}
