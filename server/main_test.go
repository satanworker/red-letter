package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const origin = "https://diff.satanworker.com"

func setup(t *testing.T) (hub *httptest.Server, wsURL string) {
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/login/oauth/access_token":
			r.ParseForm()
			json.NewEncoder(w).Encode(map[string]string{
				"secret": r.PostForm.Get("client_secret"), "code": r.PostForm.Get("code"),
				"grant": r.PostForm.Get("grant_type"), "accept": r.Header.Get("Accept"),
			})
		case strings.HasPrefix(r.URL.Path, "/repos/"):
			push := r.Header.Get("Authorization") == "Bearer good"
			if r.Header.Get("Authorization") == "Bearer bad" {
				w.WriteHeader(404)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"permissions": map[string]bool{"push": push}})
		}
	}))
	t.Cleanup(gh.Close)
	s := newServer([]string{origin, "http://localhost:5173"}, gh.URL, gh.URL, "cid", "shh")
	s.oauthID, s.oauthSecret = "oid", "oauth-shh"
	hub = httptest.NewServer(s.routes())
	t.Cleanup(hub.Close)
	return hub, "ws" + strings.TrimPrefix(hub.URL, "http") + "/sync?repo=Owner/Repo"
}

func dial(t *testing.T, url string) *websocket.Conn {
	c, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origin}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func ctx(t *testing.T) context.Context {
	c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return c
}

func join(t *testing.T, c *websocket.Conn, token, id string) {
	b, _ := json.Marshal(map[string]any{"type": "join", "token": token, "peerId": id, "peerMetadata": map[string]string{"n": id}})
	if err := c.Write(ctx(t), websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}

func readJSON(t *testing.T, c *websocket.Conn) map[string]any {
	typ, b, err := c.Read(ctx(t))
	if err != nil {
		t.Fatal(err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("want text, got %v", typ)
	}
	var m map[string]any
	json.Unmarshal(b, &m)
	return m
}

func expectClose(t *testing.T, c *websocket.Conn, code websocket.StatusCode) {
	if m := readJSON(t, c); m["type"] != "error" {
		t.Fatalf("want error, got %v", m)
	}
	_, _, err := c.Read(ctx(t))
	if got := websocket.CloseStatus(err); got != code {
		t.Fatalf("close code %v, want %v (%v)", got, code, err)
	}
}

func joined(t *testing.T, url, id string) (*websocket.Conn, map[string]any) {
	c := dial(t, url)
	join(t, c, "good", id)
	w := readJSON(t, c)
	if w["type"] != "welcome" {
		t.Fatalf("want welcome, got %v", w)
	}
	return c, w
}

func TestAuthDeny(t *testing.T) {
	_, url := setup(t)
	for _, tok := range []string{"readonly", "bad"} {
		c := dial(t, url)
		join(t, c, tok, "a")
		expectClose(t, c, 4403)
	}
}

func TestPresenceAndRouting(t *testing.T) {
	_, url := setup(t)
	a, w := joined(t, url, "a")
	if len(w["peers"].([]any)) != 0 {
		t.Fatalf("welcome peers %v", w)
	}
	b, w := joined(t, strings.Replace(url, "Owner/Repo", "owner/repo", 1), "b") // same room, case-insensitive
	peers := w["peers"].([]any)
	if len(peers) != 1 || peers[0].(map[string]any)["peerId"] != "a" {
		t.Fatalf("welcome peers %v", w)
	}
	if m := readJSON(t, a); m["type"] != "peer-joined" || m["peerId"] != "b" || m["peerMetadata"].(map[string]any)["n"] != "b" {
		t.Fatalf("peer-joined %v", m)
	}

	// Unknown target dropped; then b sends to a while also faking a sender id in its payload.
	b.Write(ctx(t), websocket.MessageBinary, append([]byte{1, 'z'}, "lost"...))
	b.Write(ctx(t), websocket.MessageBinary, append([]byte{1, 'a'}, "\x01chello"...))
	typ, got, err := a.Read(ctx(t))
	if err != nil || typ != websocket.MessageBinary {
		t.Fatal(typ, err)
	}
	if want := "\x01b\x01chello"; string(got) != want {
		t.Fatalf("got %q want %q", got, want)
	}

	b.Close(websocket.StatusNormalClosure, "")
	if m := readJSON(t, a); m["type"] != "peer-left" || m["peerId"] != "b" {
		t.Fatalf("peer-left %v", m)
	}
}

func TestDuplicatePeer(t *testing.T) {
	_, url := setup(t)
	joined(t, url, "a")
	c := dial(t, url)
	join(t, c, "good", "a")
	expectClose(t, c, 4409)
}

func TestSyncRejects(t *testing.T) {
	hub, url := setup(t)
	_, res, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://evil.example"}}})
	if err == nil || res.StatusCode != 403 {
		t.Fatalf("bad origin: %v %v", err, res)
	}
	req, _ := http.NewRequest("GET", hub.URL+"/sync?repo=../etc", nil)
	req.Header.Set("Origin", origin)
	r, _ := http.DefaultClient.Do(req)
	if r.StatusCode != 400 {
		t.Fatalf("bad repo: %d", r.StatusCode)
	}
}

func post(t *testing.T, url, org, body string) (*http.Response, string) {
	req, _ := http.NewRequest("POST", url, strings.NewReader(body))
	req.Header.Set("Origin", org)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, string(b)
}

func TestOAuth(t *testing.T) {
	hub, _ := setup(t)
	res, body := post(t, hub.URL+"/oauth/token", origin, `{"code":"c0de"}`)
	var m map[string]string
	json.Unmarshal([]byte(body), &m)
	if res.StatusCode != 200 || m["secret"] != "shh" || m["code"] != "c0de" || m["accept"] != "application/json" {
		t.Fatalf("token: %d %s", res.StatusCode, body)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != origin {
		t.Fatal("missing CORS header")
	}
	_, body = post(t, hub.URL+"/oauth/refresh", origin, `{"refresh_token":"r"}`)
	if !strings.Contains(body, `"grant":"refresh_token"`) {
		t.Fatalf("refresh: %s", body)
	}
	// "client":"oauth" must use the OAuth App's secret, never the GitHub App's
	_, body = post(t, hub.URL+"/oauth/token", origin, `{"client":"oauth","code":"c0de"}`)
	if !strings.Contains(body, `"secret":"oauth-shh"`) {
		t.Fatalf("oauth client: %s", body)
	}

	res, _ = post(t, hub.URL+"/oauth/token", "https://evil.example", `{"code":"c0de"}`)
	if res.StatusCode != 403 || res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign origin: %d", res.StatusCode)
	}
	req, _ := http.NewRequest("OPTIONS", hub.URL+"/oauth/token", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	r, _ := http.DefaultClient.Do(req)
	if r.StatusCode != 204 || r.Header.Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("preflight: %d", r.StatusCode)
	}
}
