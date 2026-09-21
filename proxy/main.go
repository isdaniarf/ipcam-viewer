// ipcam-proxy answers one port, checks a password, and forwards the request to
// the go2rtc instance that belongs to that user. Each instance holds only the
// cameras its users may see, so this program decides who talks to which
// instance and nothing else.
package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type account struct {
	password string
	backend  string
	proxy    *httputil.ReverseProxy
}

type config struct {
	listen   string
	realm    string
	accounts map[string]*account
	key      []byte
}

// A browser does not reliably attach cached Basic credentials to a WebSocket
// handshake, so /api/ws drew a second password prompt after the page had
// already been unlocked. It does send same-origin cookies on that handshake,
// so a successful Basic auth mints one and the handshake rides on it.
const (
	cookieName = "ipcam_session"
	sessionTTL = 7 * 24 * time.Hour
)

// The key comes from the passwords themselves. It survives a restart without a
// file to keep, and changing any password invalidates every session it signed.
func deriveKey(accounts map[string]*account) []byte {
	names := make([]string, 0, len(accounts))
	for name := range accounts {
		names = append(names, name)
	}
	sort.Strings(names)
	sum := sha256.New()
	for _, name := range names {
		fmt.Fprintf(sum, "%s\x00%s\x00", name, accounts[name].password)
	}
	return sum.Sum(nil)
}

func sign(key []byte, user string, expiry int64) string {
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "%s\n%d", user, expiry)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// session returns the account a valid cookie names, if it names one.
func (c *config) session(r *http.Request) (string, *account) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return "", nil
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 3 {
		return "", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", nil
	}
	expiry, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() >= expiry {
		return "", nil
	}
	user := string(raw)
	if !hmac.Equal([]byte(parts[2]), []byte(sign(c.key, user, expiry))) {
		return "", nil
	}
	acct, found := c.accounts[user]
	if !found {
		return "", nil
	}
	return user, acct
}

func (c *config) grant(w http.ResponseWriter, r *http.Request, user string) {
	expiry := time.Now().Add(sessionTTL).Unix()
	value := fmt.Sprintf("%s.%d.%s",
		base64.RawURLEncoding.EncodeToString([]byte(user)), expiry, sign(c.key, user, expiry))
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"),
		Expires:  time.Unix(expiry, 0),
	})
}

func readConfig(path string) (*config, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	cfg := &config{listen: ":80", realm: "IP Camera Viewer", accounts: map[string]*account{}}
	scanner := bufio.NewScanner(file)
	line := 0
	for scanner.Scan() {
		line++
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		fields := strings.Fields(text)
		switch fields[0] {
		case "listen":
			if len(fields) != 2 {
				return nil, fmt.Errorf("line %d: listen takes one address", line)
			}
			cfg.listen = fields[1]
		case "realm":
			if len(fields) < 2 {
				return nil, fmt.Errorf("line %d: realm takes a name", line)
			}
			cfg.realm = strings.Join(fields[1:], " ")
		case "user":
			if len(fields) != 4 {
				return nil, fmt.Errorf("line %d: user takes a name, a password and a backend", line)
			}
			if _, exists := cfg.accounts[fields[1]]; exists {
				return nil, fmt.Errorf("line %d: duplicate user %q", line, fields[1])
			}
			target, err := url.Parse(fields[3])
			if err != nil || target.Host == "" {
				return nil, fmt.Errorf("line %d: %q is not a backend address", line, fields[3])
			}
			cfg.accounts[fields[1]] = &account{
				password: fields[2],
				backend:  fields[3],
				proxy:    httputil.NewSingleHostReverseProxy(target),
			}
		default:
			return nil, fmt.Errorf("line %d: cannot read %q", line, fields[0])
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(cfg.accounts) == 0 {
		return nil, fmt.Errorf("%s names no user", path)
	}
	cfg.key = deriveKey(cfg.accounts)
	return cfg, nil
}

func (c *config) handler() http.Handler {
	challenge := fmt.Sprintf("Basic realm=%q, charset=\"UTF-8\"", c.realm)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The cookie comes first, because the WebSocket handshake carries
		// nothing else.
		if _, acct := c.session(r); acct != nil {
			r.Header.Del("Authorization")
			acct.proxy.ServeHTTP(w, r)
			return
		}
		user, password, ok := r.BasicAuth()
		if ok {
			if acct, found := c.accounts[user]; found &&
				subtle.ConstantTimeCompare([]byte(password), []byte(acct.password)) == 1 {
				c.grant(w, r, user)
				// The backend listens on loopback and trusts it, so the
				// credential stops here rather than travelling further.
				r.Header.Del("Authorization")
				acct.proxy.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("WWW-Authenticate", challenge)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	})
}

func main() {
	path := flag.String("config", "proxy.conf", "path to the proxy config")
	version := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	if *version {
		fmt.Println("ipcam-proxy 1.0")
		return
	}

	cfg, err := readConfig(*path)
	if err != nil {
		log.Fatalf("ipcam-proxy: %v", err)
	}

	names := make([]string, 0, len(cfg.accounts))
	for name := range cfg.accounts {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		log.Printf("ipcam-proxy: %s -> %s", name, cfg.accounts[name].backend)
	}

	log.Printf("ipcam-proxy: listening on %s", cfg.listen)
	server := &http.Server{Addr: cfg.listen, Handler: cfg.handler()}
	log.Fatal(server.ListenAndServe())
}
