package main

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeCamera struct {
	user     string
	password string
	offset   time.Duration
	hasPTZ   bool

	mu      sync.Mutex
	calls   []string
	presets []preset
	nextID  int
	server  *httptest.Server
}

var (
	actionPattern = regexp.MustCompile(`<s:Body><(\w+)`)
	fieldPattern  = func(name string) *regexp.Regexp {
		return regexp.MustCompile(`<` + name + `[^>]*>([^<]*)</` + name + `>`)
	}
	velocityAttrs = regexp.MustCompile(`<PanTilt [^>]*x="([^"]+)" y="([^"]+)"`)
)

func field(body, name string) string {
	match := fieldPattern(name).FindStringSubmatch(body)
	if match == nil {
		return ""
	}
	return html.UnescapeString(match[1])
}

func newFakeCamera(t *testing.T, user, password string, hasPTZ bool) *fakeCamera {
	camera := &fakeCamera{user: user, password: password, offset: time.Hour, hasPTZ: hasPTZ, nextID: 1}
	camera.server = httptest.NewServer(http.HandlerFunc(camera.serve))
	t.Cleanup(camera.server.Close)
	return camera
}

func (f *fakeCamera) port() string {
	parsed, _ := url.Parse(f.server.URL)
	return parsed.Port()
}

func (f *fakeCamera) address() string {
	return fmt.Sprintf("onvif://%s:%s@127.0.0.1:%s", url.QueryEscape(f.user), url.PathEscape(f.password), f.port())
}

func (f *fakeCamera) record(call string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, call)
}

func (f *fakeCamera) recorded() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func (f *fakeCamera) count(prefix string) int {
	total := 0
	for _, call := range f.recorded() {
		if strings.HasPrefix(call, prefix) {
			total++
		}
	}
	return total
}

func (f *fakeCamera) authorized(body string) bool {
	nonce, err := base64.StdEncoding.DecodeString(field(body, "Nonce"))
	if err != nil {
		return false
	}
	created := field(body, "Created")
	stamp, err := time.Parse("2006-01-02T15:04:05Z", created)
	if err != nil {
		return false
	}
	skew := stamp.Sub(time.Now().Add(f.offset))
	if skew > 10*time.Second || skew < -10*time.Second {
		return false
	}
	digest := sha1.New()
	digest.Write(nonce)
	digest.Write([]byte(created))
	digest.Write([]byte(f.password))
	return field(body, "Username") == f.user &&
		field(body, "Password") == base64.StdEncoding.EncodeToString(digest.Sum(nil))
}

func reply(w http.ResponseWriter, inner string) {
	w.Header().Set("Content-Type", "application/soap+xml; charset=utf-8")
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"><SOAP-ENV:Body>%s</SOAP-ENV:Body></SOAP-ENV:Envelope>`, inner)
}

func refuse(w http.ResponseWriter, status int, reason string) {
	w.WriteHeader(status)
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope"><SOAP-ENV:Body><SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value></SOAP-ENV:Code><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">%s</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`, reason)
}

func (f *fakeCamera) serve(w http.ResponseWriter, r *http.Request) {
	data, _ := io.ReadAll(r.Body)
	body := string(data)
	match := actionPattern.FindStringSubmatch(body)
	if match == nil {
		refuse(w, http.StatusBadRequest, "no action")
		return
	}
	action := match[1]
	if action == "GetSystemDateAndTime" {
		now := time.Now().Add(f.offset).UTC()
		reply(w, fmt.Sprintf(`<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:UTCDateTime><tt:Time><tt:Hour>%d</tt:Hour><tt:Minute>%d</tt:Minute><tt:Second>%d</tt:Second></tt:Time><tt:Date><tt:Year>%d</tt:Year><tt:Month>%d</tt:Month><tt:Day>%d</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>`,
			now.Hour(), now.Minute(), now.Second(), now.Year(), int(now.Month()), now.Day()))
		return
	}
	if !f.authorized(body) {
		refuse(w, http.StatusBadRequest, "Sender not Authorized")
		return
	}
	if action != "GetCapabilities" && action != "GetProfiles" && r.URL.Path != "/onvif/service" {
		refuse(w, http.StatusBadRequest, "wrong service address "+r.URL.Path)
		return
	}
	profile := field(body, "ProfileToken")
	if strings.HasPrefix(action, "Get") && action != "GetCapabilities" && action != "GetProfiles" || action == "ContinuousMove" || action == "Stop" || strings.HasSuffix(action, "Preset") {
		if profile != "profile_b" {
			refuse(w, http.StatusBadRequest, "wrong profile "+profile)
			return
		}
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	switch action {
	case "GetCapabilities":
		ptz := ""
		if f.hasPTZ {
			ptz = fmt.Sprintf(`<tt:PTZ><tt:XAddr>http://192.0.2.1:%s/onvif/service</tt:XAddr></tt:PTZ>`, f.port())
		}
		reply(w, fmt.Sprintf(`<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Device><tt:XAddr>http://192.0.2.1:%[1]s/onvif/service</tt:XAddr></tt:Device><tt:Media><tt:XAddr>http://192.0.2.1:%[1]s/onvif/service</tt:XAddr></tt:Media>%[2]s</tds:Capabilities></tds:GetCapabilitiesResponse>`, f.port(), ptz))
	case "GetProfiles":
		reply(w, `<trt:GetProfilesResponse><trt:Profiles fixed="true" token="profile_a"><tt:Name>no ptz</tt:Name></trt:Profiles><trt:Profiles fixed="true" token="profile_b"><tt:Name>ptz</tt:Name><tt:PTZConfiguration token="PTZTOKEN"><tt:Name>PTZ</tt:Name></tt:PTZConfiguration></trt:Profiles></trt:GetProfilesResponse>`)
	case "GetPresets":
		var out strings.Builder
		for _, item := range f.presets {
			fmt.Fprintf(&out, `<tptz:Preset token="%s"><tt:Name>%s</tt:Name></tptz:Preset>`, item.Token, item.Name)
		}
		reply(w, `<tptz:GetPresetsResponse>`+out.String()+`</tptz:GetPresetsResponse>`)
	case "ContinuousMove":
		velocity := velocityAttrs.FindStringSubmatch(body)
		if velocity == nil {
			refuse(w, http.StatusBadRequest, "no velocity")
			return
		}
		f.calls = append(f.calls, fmt.Sprintf("move %s %s", velocity[1], velocity[2]))
		reply(w, `<tptz:ContinuousMoveResponse/>`)
	case "Stop":
		f.calls = append(f.calls, "stop")
		reply(w, `<tptz:StopResponse/>`)
	case "GotoPreset":
		f.calls = append(f.calls, "goto "+field(body, "PresetToken"))
		reply(w, `<tptz:GotoPresetResponse/>`)
	case "SetPreset":
		token := field(body, "PresetToken")
		name := field(body, "PresetName")
		if token == "" {
			token = strconv.Itoa(f.nextID)
			f.nextID++
			f.presets = append(f.presets, preset{Token: token, Name: name})
		} else {
			for index := range f.presets {
				if f.presets[index].Token == token {
					f.presets[index].Name = name
				}
			}
		}
		f.calls = append(f.calls, "save "+token+" "+name)
		reply(w, `<tptz:SetPresetResponse><tptz:PresetToken>`+token+`</tptz:PresetToken></tptz:SetPresetResponse>`)
	case "RemovePreset":
		token := field(body, "PresetToken")
		kept := f.presets[:0]
		for _, item := range f.presets {
			if item.Token != token {
				kept = append(kept, item)
			}
		}
		f.presets = kept
		f.calls = append(f.calls, "remove "+token)
		reply(w, `<tptz:RemovePresetResponse/>`)
	default:
		refuse(w, http.StatusBadRequest, "unknown action "+action)
	}
}

func writeProxyConfig(t *testing.T, text string) *config {
	t.Helper()
	path := filepath.Join(t.TempDir(), "proxy.conf")
	if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := readConfig(path)
	if err != nil {
		t.Fatalf("readConfig: %v", err)
	}
	return cfg
}

func shortMoveHold(t *testing.T) {
	previous := moveHold
	moveHold = 150 * time.Millisecond
	t.Cleanup(func() { moveHold = previous })
}

type client struct {
	t       *testing.T
	handler http.Handler
	user    string
	pass    string
}

func (c client) do(method, target, contentType, body string, headers ...string) *httptest.ResponseRecorder {
	c.t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.SetBasicAuth(c.user, c.pass)
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	for index := 0; index+1 < len(headers); index += 2 {
		request.Header.Set(headers[index], headers[index+1])
	}
	recorder := httptest.NewRecorder()
	c.handler.ServeHTTP(recorder, request)
	return recorder
}

func (c client) post(body string) *httptest.ResponseRecorder {
	return c.do(http.MethodPost, ptzPath, "application/json", body)
}

func expectStatus(t *testing.T, response *httptest.ResponseRecorder, want int) {
	t.Helper()
	if response.Code != want {
		t.Fatalf("status %d, want %d: %s", response.Code, want, response.Body.String())
	}
}

func setup(t *testing.T) (*fakeCamera, *fakeCamera, client, client) {
	t.Helper()
	shortMoveHold(t)
	steerable := newFakeCamera(t, "owner@example.com", "p w:d@x%", true)
	fixed := newFakeCamera(t, "owner@example.com", "p w:d@x%", false)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "backend "+r.URL.Path)
	}))
	t.Cleanup(backend.Close)
	cfg := writeProxyConfig(t, strings.Join([]string{
		"listen :0",
		"user owner ownerpw " + backend.URL,
		"user guest guestpw " + backend.URL + "/",
		"camera living " + steerable.address(),
		"camera porch " + fixed.address(),
		"ptz owner living porch",
		"ptz guest porch",
	}, "\n")+"\n")
	handler := cfg.handler()
	return steerable, fixed, client{t, handler, "owner", "ownerpw"}, client{t, handler, "guest", "guestpw"}
}

func TestReadConfigDecodesCameraAddresses(t *testing.T) {
	cfg := writeProxyConfig(t, "user a b http://127.0.0.1:1\ncamera door onvif://a%40b.c:p%20w%3Ad%40x@10.0.0.1:2020\nptz a door\n")
	camera := cfg.accounts["a"].ptz["door"]
	if camera == nil {
		t.Fatal("account a cannot steer door")
	}
	if camera.user != "a@b.c" || camera.password != "p w:d@x" {
		t.Fatalf("credentials %q %q", camera.user, camera.password)
	}
	if camera.device != "http://10.0.0.1:2020/onvif/device_service" {
		t.Fatalf("device %q", camera.device)
	}
}

func TestReadConfigRefusesBadPTZLines(t *testing.T) {
	cases := map[string]string{
		"unknown camera":     "user a b http://127.0.0.1:1\nptz a door\n",
		"unknown user":       "user a b http://127.0.0.1:1\ncamera door onvif://u:p@h:1\nptz z door\n",
		"duplicate camera":   "user a b http://127.0.0.1:1\ncamera door onvif://u:p@h:1\ncamera door onvif://u:p@h:2\n",
		"not onvif":          "user a b http://127.0.0.1:1\ncamera door http://u:p@h:1\n",
		"no credentials":     "user a b http://127.0.0.1:1\ncamera door onvif://h:1\n",
		"ptz with no camera": "user a b http://127.0.0.1:1\nptz a\n",
	}
	for name, text := range cases {
		path := filepath.Join(t.TempDir(), "proxy.conf")
		if err := os.WriteFile(path, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readConfig(path); err == nil {
			t.Errorf("%s: readConfig accepted it", name)
		}
	}
}

func TestPTZReadsPresetsWithTheSkewedClockAndTheConfiguredHost(t *testing.T) {
	_, _, owner, _ := setup(t)
	response := owner.do(http.MethodGet, ptzPath+"?camera=living", "", "")
	expectStatus(t, response, http.StatusOK)
	if strings.TrimSpace(response.Body.String()) != `{"presets":[]}` {
		t.Fatalf("body %s", response.Body.String())
	}
}

func TestPTZHidesCamerasWithoutPanAndTilt(t *testing.T) {
	_, _, owner, _ := setup(t)
	expectStatus(t, owner.do(http.MethodGet, ptzPath+"?camera=porch", "", ""), http.StatusNotFound)
}

func TestPTZKeepsEachAccountToItsOwnCameras(t *testing.T) {
	steerable, _, _, guest := setup(t)
	expectStatus(t, guest.do(http.MethodGet, ptzPath+"?camera=living", "", ""), http.StatusNotFound)
	expectStatus(t, guest.post(`{"camera":"living","action":"move","pan":1,"tilt":0}`), http.StatusNotFound)
	if len(steerable.recorded()) != 0 {
		t.Fatalf("the camera received %v", steerable.recorded())
	}
}

func TestPTZMoveRepeatsWithoutResendingAndStopsWhenTheRepeatsEnd(t *testing.T) {
	steerable, _, owner, _ := setup(t)
	for range 3 {
		expectStatus(t, owner.post(`{"camera":"living","action":"move","pan":0.5,"tilt":0}`), http.StatusNoContent)
		time.Sleep(moveHold / 3)
	}
	if got := steerable.count("move"); got != 1 {
		t.Fatalf("%d ContinuousMove requests for one held direction: %v", got, steerable.recorded())
	}
	if steerable.count("stop") != 0 {
		t.Fatalf("stopped while the repeats continued: %v", steerable.recorded())
	}
	expectStatus(t, owner.post(`{"camera":"living","action":"move","pan":0.5,"tilt":-0.5}`), http.StatusNoContent)
	if got := steerable.count("move"); got != 2 {
		t.Fatalf("a new direction did not send a new move: %v", steerable.recorded())
	}
	time.Sleep(moveHold * 3)
	if steerable.count("stop") != 1 {
		t.Fatalf("the camera did not stop after the repeats ended: %v", steerable.recorded())
	}
	calls := steerable.recorded()
	if calls[0] != "move 0.50 0.00" || calls[1] != "move 0.50 -0.50" {
		t.Fatalf("velocities %v", calls)
	}
}

func TestPTZExplicitStopCancelsTheTimer(t *testing.T) {
	steerable, _, owner, _ := setup(t)
	expectStatus(t, owner.post(`{"camera":"living","action":"move","pan":-1,"tilt":1}`), http.StatusNoContent)
	expectStatus(t, owner.post(`{"camera":"living","action":"stop"}`), http.StatusNoContent)
	time.Sleep(moveHold * 3)
	if steerable.count("stop") != 1 {
		t.Fatalf("calls %v", steerable.recorded())
	}
	expectStatus(t, owner.post(`{"camera":"living","action":"move","pan":0,"tilt":0}`), http.StatusNoContent)
	if steerable.count("stop") != 2 {
		t.Fatalf("a zero move did not stop: %v", steerable.recorded())
	}
}

func decodePresets(t *testing.T, response *httptest.ResponseRecorder) []preset {
	t.Helper()
	expectStatus(t, response, http.StatusOK)
	var answer ptzAnswer
	if err := json.Unmarshal(response.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	return answer.Presets
}

func TestPTZPresets(t *testing.T) {
	steerable, _, owner, _ := setup(t)
	steerable.presets = []preset{{Token: "7", Name: "Door & Gate <1>"}}
	elsewhere := preset{Token: "7", Name: "Door & Gate <1>"}

	list := decodePresets(t, owner.do(http.MethodGet, ptzPath+"?camera=living", "", ""))
	if len(list) != 1 || list[0] != elsewhere {
		t.Fatalf("presets %v", list)
	}
	list = decodePresets(t, owner.post(`{"camera":"living","action":"save","name":"  Sofa  "}`))
	if len(list) != 2 || list[1] != (preset{Token: "1", Name: "Sofa"}) {
		t.Fatalf("presets %v", list)
	}
	list = decodePresets(t, owner.post(`{"camera":"living","action":"save","name":"Couch","preset":"1"}`))
	if len(list) != 2 || list[1] != (preset{Token: "1", Name: "Couch"}) {
		t.Fatalf("presets %v", list)
	}
	expectStatus(t, owner.post(`{"camera":"living","action":"goto","preset":"1"}`), http.StatusNoContent)
	list = decodePresets(t, owner.post(`{"camera":"living","action":"remove","preset":"1"}`))
	if len(list) != 1 || list[0] != elsewhere {
		t.Fatalf("presets %v", list)
	}
	want := []string{"save 1 Sofa", "save 1 Couch", "goto 1", "remove 1"}
	if got := steerable.recorded(); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("calls %v, want %v", got, want)
	}
}

func TestEscapeNameTextKeepsValidEntities(t *testing.T) {
	cases := map[string]string{
		`<tt:Name>a & b <c></tt:Name>`:            `<tt:Name>a &amp; b &lt;c&gt;</tt:Name>`,
		`<tt:Name>a &amp; b &#38; &lt;</tt:Name>`: `<tt:Name>a &amp; b &#38; &lt;</tt:Name>`,
		`<Name>x</Name><tt:Token>&</tt:Token>`:    `<Name>x</Name><tt:Token>&</tt:Token>`,
	}
	for in, want := range cases {
		if got := string(escapeNameText([]byte(in))); got != want {
			t.Errorf("%s: got %s, want %s", in, got, want)
		}
	}
}

func TestPTZRefusesBadRequests(t *testing.T) {
	steerable, _, owner, _ := setup(t)
	expectStatus(t, owner.do(http.MethodPost, ptzPath, "text/plain", `{"camera":"living","action":"stop"}`), http.StatusUnsupportedMediaType)
	expectStatus(t, owner.do(http.MethodPost, ptzPath, "application/json", `{"camera":"living","action":"stop"}`, "Sec-Fetch-Site", "cross-site"), http.StatusForbidden)
	expectStatus(t, owner.post(`{"camera":"living","action":"move","pan":2,"tilt":0}`), http.StatusBadRequest)
	expectStatus(t, owner.post(`{"camera":"living","action":"spin"}`), http.StatusBadRequest)
	expectStatus(t, owner.post(`{"camera":"living","action":"stop","extra":1}`), http.StatusBadRequest)
	expectStatus(t, owner.post(`{"camera":"living","action":"save","name":""}`), http.StatusBadRequest)
	expectStatus(t, owner.post(`{"camera":"living","action":"save","name":"`+strings.Repeat("x", 41)+`"}`), http.StatusBadRequest)
	expectStatus(t, owner.post(`{"camera":"living","action":"save","name":"a & b"}`), http.StatusBadRequest)
	expectStatus(t, owner.post(`{"camera":"living","action":"goto"}`), http.StatusBadRequest)
	expectStatus(t, owner.do(http.MethodDelete, ptzPath, "", ""), http.StatusMethodNotAllowed)
	if len(steerable.recorded()) != 0 {
		t.Fatalf("the camera received %v", steerable.recorded())
	}
}

func TestPTZNeedsALogin(t *testing.T) {
	_, _, owner, _ := setup(t)
	stranger := owner
	stranger.pass = "wrong"
	expectStatus(t, stranger.do(http.MethodGet, ptzPath+"?camera=living", "", ""), http.StatusUnauthorized)
}

func TestPTZReportsACameraThatRefusesTheLogin(t *testing.T) {
	shortMoveHold(t)
	camera := newFakeCamera(t, "u", "right", true)
	wrong := strings.Replace(camera.address(), ":right@", ":wrong@", 1)
	cfg := writeProxyConfig(t, "user a b http://127.0.0.1:1\ncamera c "+wrong+"\nptz a c\n")
	response := client{t, cfg.handler(), "a", "b"}.do(http.MethodGet, ptzPath+"?camera=c", "", "")
	expectStatus(t, response, http.StatusBadGateway)
	if !strings.Contains(response.Body.String(), "Sender not Authorized") {
		t.Fatalf("body %s", response.Body.String())
	}
}

func TestOtherPathsStillReachTheBackend(t *testing.T) {
	_, _, owner, _ := setup(t)
	response := owner.do(http.MethodGet, "/api/ptzzz", "", "")
	expectStatus(t, response, http.StatusOK)
	if response.Body.String() != "backend /api/ptzzz" {
		t.Fatalf("body %s", response.Body.String())
	}
}
