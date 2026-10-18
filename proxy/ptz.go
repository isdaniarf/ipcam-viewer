package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"mime"
	"net/http"
	"strings"
	"unicode"
)

const (
	ptzPath          = "/api/ptz"
	maxPresetName    = 40
	maxPresetToken   = 64
	maxPTZRequestLen = 4096
)

type ptzRequest struct {
	Camera string  `json:"camera"`
	Action string  `json:"action"`
	Pan    float64 `json:"pan"`
	Tilt   float64 `json:"tilt"`
	Preset string  `json:"preset"`
	Name   string  `json:"name"`
}

type ptzAnswer struct {
	Presets []preset `json:"presets"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func validDirection(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= -1 && value <= 1
}

func validPresetName(name string) bool {
	if name == "" || len([]rune(name)) > maxPresetName || strings.ContainsAny(name, "<>&") {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validPresetToken(token string) bool {
	return token != "" && len(token) <= maxPresetToken && !strings.ContainsFunc(token, unicode.IsControl)
}

func isJSON(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
}

func (c *config) servePTZ(w http.ResponseWriter, r *http.Request, user string, acct *account) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*requestTimeout)
	defer cancel()

	switch r.Method {
	case http.MethodGet:
		camera := acct.ptz[r.URL.Query().Get("camera")]
		if camera == nil {
			writeError(w, http.StatusNotFound, "this account cannot control that camera")
			return
		}
		list, err := camera.presets(ctx)
		if err != nil {
			c.failPTZ(w, user, camera, "read presets", err)
			return
		}
		writeJSON(w, http.StatusOK, ptzAnswer{Presets: list})

	case http.MethodPost:
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeError(w, http.StatusForbidden, "a different site cannot control the cameras")
			return
		}
		if !isJSON(r) {
			writeError(w, http.StatusUnsupportedMediaType, "send the request as application/json")
			return
		}
		var request ptzRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxPTZRequestLen))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "the request is not valid JSON")
			return
		}
		camera := acct.ptz[request.Camera]
		if camera == nil {
			writeError(w, http.StatusNotFound, "this account cannot control that camera")
			return
		}
		c.runPTZ(ctx, w, user, camera, request)

	default:
		w.Header().Set("Allow", "GET, POST")
		writeError(w, http.StatusMethodNotAllowed, "use GET or POST")
	}
}

func (c *config) runPTZ(ctx context.Context, w http.ResponseWriter, user string, camera *ptzCamera, request ptzRequest) {
	switch request.Action {
	case "move":
		if !validDirection(request.Pan) || !validDirection(request.Tilt) {
			writeError(w, http.StatusBadRequest, "pan and tilt must be between -1 and 1")
			return
		}
		var err error
		if request.Pan == 0 && request.Tilt == 0 {
			err = camera.stop(ctx)
		} else {
			err = camera.move(ctx, request.Pan, request.Tilt)
		}
		if err != nil {
			c.failPTZ(w, user, camera, "move", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case "stop":
		if err := camera.stop(ctx); err != nil {
			c.failPTZ(w, user, camera, "stop", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case "goto":
		if !validPresetToken(request.Preset) {
			writeError(w, http.StatusBadRequest, "name a preset")
			return
		}
		if err := camera.gotoPreset(ctx, request.Preset); err != nil {
			c.failPTZ(w, user, camera, "go to a preset", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case "save":
		name := strings.TrimSpace(request.Name)
		if !validPresetName(name) {
			writeError(w, http.StatusBadRequest, "a preset name needs 1 to 40 characters and no < > or &")
			return
		}
		if request.Preset != "" && !validPresetToken(request.Preset) {
			writeError(w, http.StatusBadRequest, "the preset is not valid")
			return
		}
		list, err := camera.savePreset(ctx, name, request.Preset)
		if err != nil {
			c.failPTZ(w, user, camera, "save a preset", err)
			return
		}
		writeJSON(w, http.StatusOK, ptzAnswer{Presets: list})

	case "remove":
		if !validPresetToken(request.Preset) {
			writeError(w, http.StatusBadRequest, "name a preset")
			return
		}
		list, err := camera.removePreset(ctx, request.Preset)
		if err != nil {
			c.failPTZ(w, user, camera, "remove a preset", err)
			return
		}
		writeJSON(w, http.StatusOK, ptzAnswer{Presets: list})

	default:
		writeError(w, http.StatusBadRequest, "the action must be move, stop, goto, save or remove")
	}
}

func (c *config) failPTZ(w http.ResponseWriter, user string, camera *ptzCamera, action string, err error) {
	if errors.Is(err, errNoPTZ) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	log.Printf("ipcam-proxy: %s could not %s on %s: %v", user, action, camera.name, err)
	writeError(w, http.StatusBadGateway, err.Error())
}
