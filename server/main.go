// Command server is the Red Letter hub: a dumb WebSocket router between peers
// in a repo room, the GitHub App OAuth code/refresh exchange, and an inbox for
// bug reports.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	maxFrame     = 16 << 20
	sendQueue    = 256
	authTTL      = 5 * time.Minute
	joinTimeout  = 10 * time.Second
	pingEvery    = 30 * time.Second
	pongTimeout  = 10 * time.Second
	writeTimeout = 10 * time.Second
	maxReport    = 8 << 20
)

var repoRE = regexp.MustCompile(`^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`)

type server struct {
	origins          map[string]bool
	api, web         string
	clientID, secret string
	// optional classic OAuth App ("client":"oauth"): one-click sign-in without installing the GitHub App
	oauthID, oauthSecret string
	reports              string // directory bug reports are written to
	client               *http.Client

	mu    sync.Mutex
	rooms map[string]map[string]*peer

	cacheMu sync.Mutex
	cache   map[[32]byte]authEntry
}

type authEntry struct {
	ok  bool
	exp time.Time
}

type frame struct {
	typ  websocket.MessageType
	data []byte
}

type peer struct {
	id     string
	meta   json.RawMessage
	send   chan frame
	cancel context.CancelFunc
}

// enqueue must be called with s.mu held. A full queue drops the slow peer.
func (p *peer) enqueue(f frame) {
	select {
	case p.send <- f:
	default:
		p.cancel()
	}
}

func textFrame(v any) frame {
	b, _ := json.Marshal(v)
	return frame{websocket.MessageText, b}
}

func newServer(origins []string, api, web, clientID, secret string) *server {
	s := &server{
		origins:  map[string]bool{},
		api:      strings.TrimRight(api, "/"),
		web:      strings.TrimRight(web, "/"),
		clientID: clientID,
		secret:   secret,
		client:   &http.Client{Timeout: 10 * time.Second},
		rooms:    map[string]map[string]*peer{},
		cache:    map[[32]byte]authEntry{},
	}
	for _, o := range origins {
		if o = strings.TrimSpace(o); o != "" {
			s.origins[o] = true
		}
	}
	return s
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("GET /sync", s.handleSync)
	mux.HandleFunc("/oauth/token", s.oauth(false))
	mux.HandleFunc("/oauth/refresh", s.oauth(true))
	mux.HandleFunc("/report", s.report)
	return mux
}

// authorized reports whether token has push access to repo, cached per token+room.
func (s *server) authorized(ctx context.Context, token, repo string) bool {
	key := sha256.Sum256([]byte(token + "\x00" + strings.ToLower(repo)))
	now := time.Now()
	s.cacheMu.Lock()
	e, hit := s.cache[key]
	s.cacheMu.Unlock()
	if hit && now.Before(e.exp) {
		return e.ok
	}
	req, err := http.NewRequestWithContext(ctx, "GET", s.api+"/repos/"+repo, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := s.client.Do(req)
	if err != nil {
		return false // transient: not cached
	}
	defer res.Body.Close()
	var body struct {
		Permissions struct {
			Push bool `json:"push"`
		} `json:"permissions"`
	}
	if res.StatusCode >= 500 {
		return false // transient: not cached
	}
	ok := res.StatusCode == 200 && json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body) == nil && body.Permissions.Push
	s.cacheMu.Lock()
	// ponytail: O(n) sweep per miss; fine until millions of distinct tokens.
	for k, v := range s.cache {
		if now.After(v.exp) {
			delete(s.cache, k)
		}
	}
	s.cache[key] = authEntry{ok, now.Add(authTTL)}
	s.cacheMu.Unlock()
	return ok
}

func (s *server) handleSync(w http.ResponseWriter, r *http.Request) {
	if !s.origins[r.Header.Get("Origin")] {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}
	repo := r.URL.Query().Get("repo")
	if !repoRE.MatchString(repo) {
		http.Error(w, "bad repo", http.StatusBadRequest)
		return
	}
	// room = repo + document (branch/path), so presence means "on this file"; access is still checked per repo
	doc := r.URL.Query().Get("doc")
	if len(doc) > 1024 {
		http.Error(w, "bad doc", http.StatusBadRequest)
		return
	}
	room := strings.ToLower(repo) + " " + doc
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true}) // origin checked above
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(maxFrame)

	fail := func(code websocket.StatusCode, msg string) {
		ctx, cancel := context.WithTimeout(r.Context(), writeTimeout)
		defer cancel()
		f := textFrame(map[string]string{"type": "error", "message": msg})
		conn.Write(ctx, f.typ, f.data)
		conn.Close(code, msg)
	}

	jctx, jcancel := context.WithTimeout(r.Context(), joinTimeout)
	typ, data, err := conn.Read(jctx)
	jcancel()
	if err != nil {
		return
	}
	var join struct {
		Type         string          `json:"type"`
		Token        string          `json:"token"`
		PeerID       string          `json:"peerId"`
		PeerMetadata json.RawMessage `json:"peerMetadata"`
	}
	if typ != websocket.MessageText || json.Unmarshal(data, &join) != nil || join.Type != "join" ||
		join.Token == "" || len(join.PeerID) == 0 || len(join.PeerID) > 64 {
		fail(websocket.StatusPolicyViolation, "expected join")
		return
	}
	if len(join.PeerMetadata) == 0 {
		join.PeerMetadata = json.RawMessage("null")
	}
	if !s.authorized(r.Context(), join.Token, repo) {
		log.Printf("auth denied room=%s peer=%s", room, join.PeerID)
		fail(4403, "no push access to "+repo)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	me := &peer{id: join.PeerID, meta: join.PeerMetadata, send: make(chan frame, sendQueue), cancel: cancel}

	type info struct {
		PeerID       string          `json:"peerId"`
		PeerMetadata json.RawMessage `json:"peerMetadata"`
	}
	s.mu.Lock()
	peers := s.rooms[room]
	if peers[me.id] != nil {
		s.mu.Unlock()
		fail(4409, "peerId already in room")
		return
	}
	if peers == nil {
		peers = map[string]*peer{}
		s.rooms[room] = peers
	}
	others := []info{}
	joined := textFrame(map[string]any{"type": "peer-joined", "peerId": me.id, "peerMetadata": me.meta})
	for _, p := range peers {
		others = append(others, info{p.id, p.meta})
		p.enqueue(joined)
	}
	peers[me.id] = me
	me.enqueue(textFrame(map[string]any{"type": "welcome", "peers": others}))
	s.mu.Unlock()
	log.Printf("connect room=%s peer=%s", room, me.id)

	defer func() {
		s.mu.Lock()
		delete(peers, me.id)
		if len(peers) == 0 {
			delete(s.rooms, room)
		}
		left := textFrame(map[string]string{"type": "peer-left", "peerId": me.id})
		for _, p := range peers {
			p.enqueue(left)
		}
		s.mu.Unlock()
		log.Printf("disconnect room=%s peer=%s", room, me.id)
	}()

	go func() { // writer: the only goroutine writing data frames
		for {
			select {
			case <-ctx.Done():
				conn.CloseNow()
				return
			case f := <-me.send:
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := conn.Write(wctx, f.typ, f.data)
				wcancel()
				if err != nil {
					cancel()
				}
			}
		}
	}()
	go func() { // keepalive: Cloudflare drops idle sockets after 100 s
		t := time.NewTicker(pingEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				pctx, pcancel := context.WithTimeout(ctx, pongTimeout)
				err := conn.Ping(pctx)
				pcancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()

	sender := append([]byte{byte(len(me.id))}, me.id...)
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if typ != websocket.MessageBinary || len(data) < 1 || len(data) < 1+int(data[0]) {
			continue
		}
		n := int(data[0])
		target, payload := string(data[1:1+n]), data[1+n:]
		out := make([]byte, 0, len(sender)+len(payload))
		out = append(append(out, sender...), payload...)
		s.mu.Lock()
		if p := peers[target]; p != nil && p != me {
			p.enqueue(frame{websocket.MessageBinary, out})
		}
		s.mu.Unlock()
	}
}

func (s *server) oauth(refresh bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.cors(w, r, "content-type") {
			return
		}
		h := w.Header()
		var in struct {
			Client       string `json:"client"`
			Code         string `json:"code"`
			CodeVerifier string `json:"code_verifier"`
			RedirectURI  string `json:"redirect_uri"`
			RefreshToken string `json:"refresh_token"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in) != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		form := url.Values{"client_id": {s.clientID}, "client_secret": {s.secret}}
		if in.Client == "oauth" {
			if s.oauthID == "" {
				http.Error(w, "oauth app not configured", http.StatusNotFound)
				return
			}
			form = url.Values{"client_id": {s.oauthID}, "client_secret": {s.oauthSecret}}
		}
		if refresh {
			if in.RefreshToken == "" {
				http.Error(w, "missing refresh_token", http.StatusBadRequest)
				return
			}
			form.Set("grant_type", "refresh_token")
			form.Set("refresh_token", in.RefreshToken)
		} else {
			if in.Code == "" {
				http.Error(w, "missing code", http.StatusBadRequest)
				return
			}
			form.Set("code", in.Code)
			if in.CodeVerifier != "" {
				form.Set("code_verifier", in.CodeVerifier)
			}
			if in.RedirectURI != "" {
				form.Set("redirect_uri", in.RedirectURI)
			}
		}
		req, err := http.NewRequestWithContext(r.Context(), "POST", s.web+"/login/oauth/access_token", strings.NewReader(form.Encode()))
		if err != nil {
			http.Error(w, "bad upstream", http.StatusBadGateway)
			return
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Accept", "application/json")
		res, err := s.client.Do(req)
		if err != nil {
			http.Error(w, "github unreachable", http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if err != nil {
			http.Error(w, "github unreachable", http.StatusBadGateway)
			return
		}
		h.Set("Content-Type", "application/json")
		h.Set("Cache-Control", "no-store")
		w.Write(body)
	}
}

// cors answers for an allowed origin (false: refused, or a preflight already answered).
func (s *server) cors(w http.ResponseWriter, r *http.Request, headers string) bool {
	origin := r.Header.Get("Origin")
	if !s.origins[origin] {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return false
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", headers)
	h.Add("Vary", "Origin")
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
		return false
	case http.MethodPost:
		return true
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	return false
}

// login is the GitHub account a token belongs to, or "" when GitHub doesn't know it.
func (s *server) login(ctx context.Context, token string) string {
	req, err := http.NewRequestWithContext(ctx, "GET", s.api+"/user", nil)
	if err != nil || token == "" {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	res, err := s.client.Do(req)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	var u struct {
		Login string `json:"login"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&u) != nil || !loginRE.MatchString(u.Login) {
		return ""
	}
	return u.Login
}

var loginRE = regexp.MustCompile(`^[A-Za-z0-9-]{1,39}$`)

// report stores a bug report (the app's JSON, up to maxReport) from any signed-in GitHub user as one file in
// s.reports, named <UTC time>-<login>-<random>. Only whoever runs the hub reads them; the id comes back so the
// user can quote it.
// ponytail: no per-user rate limit; the token check and the size cap are the only brakes. Add one if it's abused.
func (s *server) report(w http.ResponseWriter, r *http.Request) {
	if !s.cors(w, r, "content-type, authorization") {
		return
	}
	login := s.login(r.Context(), strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if login == "" {
		http.Error(w, "sign in with GitHub to send a report", http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxReport+1))
	switch {
	case err != nil:
		http.Error(w, "couldn't read the report", http.StatusBadRequest)
		return
	case len(body) > maxReport:
		http.Error(w, "report too large", http.StatusRequestEntityTooLarge)
		return
	case !json.Valid(body):
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	var b [4]byte
	rand.Read(b[:])
	id := time.Now().UTC().Format("20060102-150405") + "-" + login + "-" + hex.EncodeToString(b[:])
	if err := os.MkdirAll(s.reports, 0o700); err != nil {
		log.Printf("report %s: %v", id, err)
		http.Error(w, "couldn't store the report", http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(filepath.Join(s.reports, id+".json"), body, 0o600); err != nil {
		log.Printf("report %s: %v", id, err)
		http.Error(w, "couldn't store the report", http.StatusInternalServerError)
		return
	}
	log.Printf("report %s (%d bytes)", id, len(body))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	s := newServer(strings.Split(os.Getenv("RL_ORIGINS"), ","),
		env("RL_GITHUB_API", "https://api.github.com"), env("RL_GITHUB_WEB", "https://github.com"),
		os.Getenv("RL_GITHUB_CLIENT_ID"), os.Getenv("RL_GITHUB_CLIENT_SECRET"))
	addr := env("RL_ADDR", "127.0.0.1:8787")
	s.oauthID, s.oauthSecret = os.Getenv("RL_OAUTH_CLIENT_ID"), os.Getenv("RL_OAUTH_CLIENT_SECRET")
	home, _ := os.UserHomeDir()
	s.reports = env("RL_REPORTS", filepath.Join(home, ".config", "red-letter", "reports"))
	srv := &http.Server{Addr: addr, Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second}
	log.Printf("listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}
