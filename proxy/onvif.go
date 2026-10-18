package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var errNoPTZ = errors.New("this camera has no pan and tilt")

var (
	moveHold       = 1200 * time.Millisecond
	requestTimeout = 6 * time.Second
	retryNoPTZ     = 10 * time.Minute
	retryFailure   = 15 * time.Second
)

const (
	deviceNS = "http://www.onvif.org/ver10/device/wsdl"
	mediaNS  = "http://www.onvif.org/ver10/media/wsdl"
	ptzNS    = "http://www.onvif.org/ver20/ptz/wsdl"
	schemaNS = "http://www.onvif.org/ver10/schema"
)

var (
	nameElement   = regexp.MustCompile(`(?s)(<(?:[A-Za-z0-9_.-]+:)?Name>)(.*?)(</(?:[A-Za-z0-9_.-]+:)?Name>)`)
	ampersandUsed = regexp.MustCompile(`&(?:(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);)?`)
)

func escapeNameText(data []byte) []byte {
	return nameElement.ReplaceAllFunc(data, func(match []byte) []byte {
		parts := nameElement.FindSubmatch(match)
		text := ampersandUsed.ReplaceAllFunc(parts[2], func(found []byte) []byte {
			if len(found) > 1 {
				return found
			}
			return []byte("&amp;")
		})
		text = bytes.ReplaceAll(text, []byte("<"), []byte("&lt;"))
		text = bytes.ReplaceAll(text, []byte(">"), []byte("&gt;"))
		out := append([]byte{}, parts[1]...)
		out = append(out, text...)
		return append(out, parts[3]...)
	})
}

type preset struct {
	Token string `json:"token"`
	Name  string `json:"name"`
}

type ptzCamera struct {
	name     string
	host     string
	device   string
	user     string
	password string
	client   *http.Client

	mu       sync.Mutex
	ready    bool
	checked  time.Time
	failure  error
	service  string
	profile  string
	offset   time.Duration
	moving   bool
	velocity [2]float64
	moveGen  uint64
	timer    *time.Timer
}

func newPTZCamera(name, address string) (*ptzCamera, error) {
	parsed, err := url.Parse(address)
	if err != nil || parsed.Scheme != "onvif" || parsed.Host == "" || parsed.User == nil {
		return nil, fmt.Errorf("%q is not an onvif://user:password@host:port address", address)
	}
	password, _ := parsed.User.Password()
	return &ptzCamera{
		name:     name,
		host:     parsed.Hostname(),
		device:   (&url.URL{Scheme: "http", Host: parsed.Host, Path: "/onvif/device_service"}).String(),
		user:     parsed.User.Username(),
		password: password,
		client:   &http.Client{Timeout: requestTimeout},
	}, nil
}

func escape(text string) string {
	var out strings.Builder
	_ = xml.EscapeText(&out, []byte(text))
	return out.String()
}

func envelope(user, password string, created time.Time, body string) []byte {
	nonce := make([]byte, 16)
	_, _ = rand.Read(nonce)
	stamp := created.UTC().Format("2006-01-02T15:04:05Z")
	digest := sha1.New()
	digest.Write(nonce)
	digest.Write([]byte(stamp))
	digest.Write([]byte(password))

	var out bytes.Buffer
	out.WriteString(`<?xml version="1.0" encoding="UTF-8"?>`)
	out.WriteString(`<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">`)
	if user != "" {
		out.WriteString(`<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken>`)
		fmt.Fprintf(&out, `<Username>%s</Username>`, escape(user))
		fmt.Fprintf(&out, `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">%s</Password>`,
			base64.StdEncoding.EncodeToString(digest.Sum(nil)))
		fmt.Fprintf(&out, `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-soap-message-security-1.0#Base64Binary">%s</Nonce>`,
			base64.StdEncoding.EncodeToString(nonce))
		fmt.Fprintf(&out, `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">%s</Created>`, stamp)
		out.WriteString(`</UsernameToken></Security></s:Header>`)
	}
	fmt.Fprintf(&out, `<s:Body>%s</s:Body></s:Envelope>`, body)
	return out.Bytes()
}

type unreachableError struct{ err error }

func (e *unreachableError) Error() string { return e.err.Error() }
func (e *unreachableError) Unwrap() error { return e.err }

type soapFault struct {
	Reason string `xml:"Body>Fault>Reason>Text"`
	Code   string `xml:"Body>Fault>Code>Subcode>Value"`
}

func (c *ptzCamera) call(ctx context.Context, address, body string, signed bool) ([]byte, error) {
	user := ""
	if signed {
		user = c.user
	}
	payload := envelope(user, c.password, time.Now().Add(c.offset), body)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, address, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/soap+xml; charset=utf-8")
	response, err := c.client.Do(request)
	if err != nil {
		return nil, &unreachableError{fmt.Errorf("camera %s did not answer: %w", c.name, err)}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 400 {
		var fault soapFault
		_ = xml.Unmarshal(data, &fault)
		reason := strings.TrimSpace(fault.Reason)
		if reason == "" {
			reason = strings.TrimSpace(fault.Code)
		}
		return nil, fmt.Errorf("camera %s refused the request: HTTP %d %s", c.name, response.StatusCode, reason)
	}
	return data, nil
}

func (c *ptzCamera) measureClockOffset(ctx context.Context) error {
	data, err := c.call(ctx, c.device, `<GetSystemDateAndTime xmlns="`+deviceNS+`"/>`, false)
	var unreachable *unreachableError
	if errors.As(err, &unreachable) {
		return err
	}
	if err != nil {
		return nil
	}
	var answer struct {
		Time struct {
			Hour   int `xml:"Time>Hour"`
			Minute int `xml:"Time>Minute"`
			Second int `xml:"Time>Second"`
			Year   int `xml:"Date>Year"`
			Month  int `xml:"Date>Month"`
			Day    int `xml:"Date>Day"`
		} `xml:"Body>GetSystemDateAndTimeResponse>SystemDateAndTime>UTCDateTime"`
	}
	if xml.Unmarshal(data, &answer) != nil || answer.Time.Year == 0 {
		return nil
	}
	t := answer.Time
	camera := time.Date(t.Year, time.Month(t.Month), t.Day, t.Hour, t.Minute, t.Second, 0, time.UTC)
	c.offset = time.Until(camera)
	return nil
}

func (c *ptzCamera) addressOnConfiguredHost(reported string) string {
	parsed, err := url.Parse(strings.TrimSpace(reported))
	if err != nil || parsed.Host == "" {
		return ""
	}
	if port := parsed.Port(); port != "" {
		parsed.Host = c.host + ":" + port
	} else {
		parsed.Host = c.host
	}
	return parsed.String()
}

func (c *ptzCamera) discover(ctx context.Context) error {
	if err := c.measureClockOffset(ctx); err != nil {
		return err
	}

	data, err := c.call(ctx, c.device,
		`<GetCapabilities xmlns="`+deviceNS+`"><Category>All</Category></GetCapabilities>`, true)
	if err != nil {
		return err
	}
	var capabilities struct {
		Media string `xml:"Body>GetCapabilitiesResponse>Capabilities>Media>XAddr"`
		PTZ   string `xml:"Body>GetCapabilitiesResponse>Capabilities>PTZ>XAddr"`
	}
	if err := xml.Unmarshal(data, &capabilities); err != nil {
		return fmt.Errorf("camera %s sent unreadable capabilities: %w", c.name, err)
	}
	ptz := c.addressOnConfiguredHost(capabilities.PTZ)
	media := c.addressOnConfiguredHost(capabilities.Media)
	if ptz == "" || media == "" {
		return errNoPTZ
	}

	data, err = c.call(ctx, media, `<GetProfiles xmlns="`+mediaNS+`"/>`, true)
	if err != nil {
		return err
	}
	var profiles struct {
		Profiles []struct {
			Token string `xml:"token,attr"`
			PTZ   *struct {
				Token string `xml:"token,attr"`
			} `xml:"PTZConfiguration"`
		} `xml:"Body>GetProfilesResponse>Profiles"`
	}
	if err := xml.Unmarshal(data, &profiles); err != nil {
		return fmt.Errorf("camera %s sent unreadable profiles: %w", c.name, err)
	}
	for _, profile := range profiles.Profiles {
		if profile.PTZ != nil && profile.Token != "" {
			c.service = ptz
			c.profile = profile.Token
			return nil
		}
	}
	return errNoPTZ
}

func (c *ptzCamera) prepareLocked(ctx context.Context) error {
	if c.ready {
		return nil
	}
	if c.failure != nil {
		wait := retryFailure
		if errors.Is(c.failure, errNoPTZ) {
			wait = retryNoPTZ
		}
		if time.Since(c.checked) < wait {
			return c.failure
		}
	}
	err := c.discover(ctx)
	c.checked = time.Now()
	c.failure = err
	c.ready = err == nil
	return err
}

func (c *ptzCamera) ptzCall(ctx context.Context, body string) ([]byte, error) {
	data, err := c.call(ctx, c.service, body, true)
	var unreachable *unreachableError
	if errors.As(err, &unreachable) {
		c.ready = false
	}
	return data, err
}

func speed(value float64) string { return strconv.FormatFloat(value, 'f', 2, 64) }

func (c *ptzCamera) presets(ctx context.Context) ([]preset, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.prepareLocked(ctx); err != nil {
		return nil, err
	}
	return c.listPresetsLocked(ctx)
}

func (c *ptzCamera) listPresetsLocked(ctx context.Context) ([]preset, error) {
	data, err := c.ptzCall(ctx, fmt.Sprintf(`<GetPresets xmlns="%s"><ProfileToken>%s</ProfileToken></GetPresets>`,
		ptzNS, escape(c.profile)))
	if err != nil {
		return nil, err
	}
	var answer struct {
		Presets []struct {
			Token string `xml:"token,attr"`
			Name  string `xml:"Name"`
		} `xml:"Body>GetPresetsResponse>Preset"`
	}
	if err := xml.Unmarshal(escapeNameText(data), &answer); err != nil {
		return nil, fmt.Errorf("camera %s sent unreadable presets: %w", c.name, err)
	}
	list := make([]preset, 0, len(answer.Presets))
	for _, item := range answer.Presets {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = item.Token
		}
		list = append(list, preset{Token: item.Token, Name: name})
	}
	return list, nil
}

func (c *ptzCamera) move(ctx context.Context, pan, tilt float64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.prepareLocked(ctx); err != nil {
		return err
	}
	velocity := [2]float64{pan, tilt}
	if !c.moving || c.velocity != velocity {
		body := fmt.Sprintf(`<ContinuousMove xmlns="%s"><ProfileToken>%s</ProfileToken><Velocity><PanTilt xmlns="%s" x="%s" y="%s"/></Velocity></ContinuousMove>`,
			ptzNS, escape(c.profile), schemaNS, speed(pan), speed(tilt))
		if _, err := c.ptzCall(ctx, body); err != nil {
			return err
		}
		c.moving = true
		c.velocity = velocity
	}
	c.moveGen++
	generation := c.moveGen
	if c.timer != nil {
		c.timer.Stop()
	}
	c.timer = time.AfterFunc(moveHold, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if generation != c.moveGen || !c.moving {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
		defer cancel()
		_ = c.sendStopLocked(ctx)
	})
	return nil
}

func (c *ptzCamera) stop(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.prepareLocked(ctx); err != nil {
		return err
	}
	return c.sendStopLocked(ctx)
}

func (c *ptzCamera) sendStopLocked(ctx context.Context) error {
	c.moveGen++
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.moving = false
	_, err := c.ptzCall(ctx, fmt.Sprintf(`<Stop xmlns="%s"><ProfileToken>%s</ProfileToken><PanTilt>true</PanTilt><Zoom>false</Zoom></Stop>`,
		ptzNS, escape(c.profile)))
	return err
}

func (c *ptzCamera) gotoPreset(ctx context.Context, token string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.prepareLocked(ctx); err != nil {
		return err
	}
	c.moveGen++
	c.moving = false
	_, err := c.ptzCall(ctx, fmt.Sprintf(`<GotoPreset xmlns="%s"><ProfileToken>%s</ProfileToken><PresetToken>%s</PresetToken></GotoPreset>`,
		ptzNS, escape(c.profile), escape(token)))
	return err
}

func (c *ptzCamera) savePreset(ctx context.Context, name, token string) ([]preset, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.prepareLocked(ctx); err != nil {
		return nil, err
	}
	replace := ""
	if token != "" {
		replace = fmt.Sprintf(`<PresetToken>%s</PresetToken>`, escape(token))
	}
	if _, err := c.ptzCall(ctx, fmt.Sprintf(`<SetPreset xmlns="%s"><ProfileToken>%s</ProfileToken><PresetName>%s</PresetName>%s</SetPreset>`,
		ptzNS, escape(c.profile), escape(name), replace)); err != nil {
		return nil, err
	}
	return c.listPresetsLocked(ctx)
}

func (c *ptzCamera) removePreset(ctx context.Context, token string) ([]preset, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.prepareLocked(ctx); err != nil {
		return nil, err
	}
	if _, err := c.ptzCall(ctx, fmt.Sprintf(`<RemovePreset xmlns="%s"><ProfileToken>%s</ProfileToken><PresetToken>%s</PresetToken></RemovePreset>`,
		ptzNS, escape(c.profile), escape(token))); err != nil {
		return nil, err
	}
	return c.listPresetsLocked(ctx)
}
