// ipcam-proxy answers one port, checks a password, and forwards the request to
// the go2rtc instance that belongs to that user. Each instance holds only the
// cameras its users may see, so this program decides who talks to which
// instance and nothing else.
package main

import (
	"bufio"
	"crypto/subtle"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"sort"
	"strings"
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
	return cfg, nil
}

func (c *config) handler() http.Handler {
	challenge := fmt.Sprintf("Basic realm=%q, charset=\"UTF-8\"", c.realm)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if ok {
			if acct, found := c.accounts[user]; found &&
				subtle.ConstantTimeCompare([]byte(password), []byte(acct.password)) == 1 {
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
