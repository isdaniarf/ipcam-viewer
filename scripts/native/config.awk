BEGIN {
  for (i = 1; i < 256; i++) ord[sprintf("%c", i)] = i
  unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
  if (out == "") out = "."
  if (static_dir == "") static_dir = "www"
  nsec = 0; nerr = 0; cur = ""
  proto[1] = "rtsp"; proto[2] = "onvif"; proto[3] = "tapo"; nproto = 3
  split("listen username password candidates allow_paths", list, " "); for (i in list) server_key[list[i]]
  split("listen username password cameras webrtc allow_paths", list, " "); for (i in list) view_key[list[i]]
  split("/ /assets /cameras.json /api/ws /api/hls", list, " ")
  ndefault_allow = 0
  for (i = 1; i <= 5; i++) default_allow[++ndefault_allow] = list[i]
  split("label host username password route", list, " "); for (i in list) camera_key[list[i]]
  split("api assets index.html cameras.json", list, " "); for (i in list) reserved_route[list[i]]
  split("rtsp.port rtsp.path rtsp.sub_path rtsp.username rtsp.password onvif.port onvif.profile onvif.sub_profile onvif.username onvif.password tapo.username tapo.password", list, " ")
  for (i in list) proto_key[list[i]]
}

function trim(s) { sub(/\r$/, "", s); sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function err(msg) { errs[++nerr] = msg }

function encode(s,   o, i, c) {
  o = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (index(unreserved, c) > 0) o = o c
    else o = o sprintf("%%%02X", ord[c])
  }
  return o
}

function auth(user, pass) {
  if (user == "") return encode(pass)
  return encode(user) ":" encode(pass)
}

function yq(s) { gsub(/'/, "''", s); return "'" s "'" }

function jq(s,   o, i, c, code) {
  o = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1); code = ord[c]
    if (c == "\"") o = o "\\\""
    else if (c == "\\") o = o "\\\\"
    else if (code < 32) {
      if (c == "\n") o = o "\\n"; else if (c == "\r") o = o "\\r"; else if (c == "\t") o = o "\\t"
      else if (code == 8) o = o "\\b"; else if (code == 12) o = o "\\f"
      else o = o sprintf("\\u%04x", code)
    } else o = o c
  }
  return "\"" o "\""
}

function label_of(name,   n, parts, i, w, o) {
  gsub(/[_-]+/, " ", name)
  n = split(name, parts, " ")
  o = ""
  for (i = 1; i <= n; i++) {
    w = parts[i]
    o = o (i > 1 ? " " : "") toupper(substr(w, 1, 1)) substr(w, 2)
  }
  return o
}

function has(sec, key) { return ((sec SUBSEP key) in val) }
function get(sec, key) { return val[sec, key] }
function need(where, sec, key, shown,   v) {
  v = has(sec, key) ? get(sec, key) : ""
  if (v == "") { err(where " needs `" shown "`."); return "" }
  return v
}

{
  line = trim($0)
  if (line == "" || line ~ /^[;#]/) next
  if (line ~ /^\[[^]]+\]$/) {
    name = trim(substr(line, 2, length(line) - 2))
    if (name in secidx) err("line " NR ": duplicate section [" name "]")
    cur = name
    if (!(name in secidx)) { secidx[name] = ++nsec; secname[nsec] = name }
    next
  }
  eq = index(line, "=")
  if (eq == 0) { err("line " NR ": expected `key = value` or a [section] header"); next }
  if (cur == "") { err("line " NR ": a key appears before the first [section]"); next }
  key = trim(substr(line, 1, eq - 1)); value = trim(substr(line, eq + 1))
  if (key !~ /^[A-Za-z0-9_.]+$/) { err("line " NR ": invalid key \"" key "\". Use letters, digits, \"_\" and \".\""); next }
  if (has(cur, key)) { err("line " NR ": duplicate key \"" key "\" in [" cur "]"); next }
  val[cur, key] = value; vline[cur, key] = NR
  keys[cur, ++nkeys[cur]] = key
}

END {
  if (nsec == 0 && nerr == 0) err("cameras.ini names no camera. Add a [camera_name] section.")

  listen = ":80"; viewer = "viewer"; secret = ""; ncand = 0
  if ("server" in secidx) {
    for (i = 1; i <= nkeys["server"]; i++) {
      k = keys["server", i]
      if (!(k in server_key)) { err("line " vline["server", k] ": unknown key \"" k "\" in [server]"); continue }
      if (get("server", k) == "") { err("line " vline["server", k] ": \"" k "\" has no value"); continue }
    }
    if (has("server", "listen")) listen = get("server", "listen")
    if (has("server", "username")) viewer = get("server", "username")
    if (has("server", "password")) secret = get("server", "password")
    if (has("server", "candidates")) {
      m = split(get("server", "candidates"), raw, ",")
      for (i = 1; i <= m; i++) { c = trim(raw[i]); if (c != "") cand[++ncand] = c ":8555" }
    }
    if (has("server", "allow_paths")) {
      m = split(get("server", "allow_paths"), raw, ",")
      for (i = 1; i <= m; i++) { c = trim(raw[i]); if (c != "") allow[++nallow] = c }
    }
  }
  if (ENVIRON["HOST_IP"] != "") {
    ncand = 0
    m = split(ENVIRON["HOST_IP"], raw, ",")
    for (i = 1; i <= m; i++) { c = trim(raw[i]); if (c != "") cand[++ncand] = c ":8555" }
  }
  if (secret == "") err("`server.password` is missing. The native server needs a viewer password, because the go2rtc API shows the camera passwords to every client without one.")

  nstreams = 0; ncams = 0
  for (s = 1; s <= nsec; s++) {
    name = secname[s]
    if (name == "server" || index(name, "view:") == 1) continue
    where = "camera \"" name "\""
    if (name !~ /^[A-Za-z0-9_-]+$/) { err(where " has an invalid name. Use letters, digits, \"_\" and \"-\" only."); continue }

    split("", enabled); split("", seen_enabled)
    for (i = 1; i <= nkeys[name]; i++) {
      k = keys[name, i]; v = get(name, k); ln = vline[name, k]
      dot = index(k, ".")
      if (dot == 0) {
        if (k == "rtsp" || k == "onvif" || k == "tapo") {
          if (v == "" || v == "on" || v == "yes" || v == "true" || v == "1") { if (!(k in enabled)) enabled[k] = 1 }
          else if (v == "off" || v == "no" || v == "false" || v == "0") enabled[k] = 0
          else err("line " ln ": \"" k "\" takes on or off, not \"" v "\"")
          continue
        }
        if (v == "") { err("line " ln ": \"" k "\" has no value"); continue }
        if (k in camera_key) continue
        err("line " ln ": unknown key \"" k "\" in [" name "]"); continue
      }
      if (v == "") { err("line " ln ": \"" k "\" has no value"); continue }
      p = substr(k, 1, dot - 1)
      if (p != "rtsp" && p != "onvif" && p != "tapo") { err("line " ln ": unknown protocol \"" p "\" in key \"" k "\""); continue }
      if (!(k in proto_key)) { err("line " ln ": unknown key \"" k "\" in [" name "]"); continue }
      if ((p in enabled) && enabled[p] == 0) continue
      if (!(p in enabled)) enabled[p] = 1
    }

    if (need(where, name, "host", "host") == "") continue
    host = get(name, "host")

    if (has(name, "route")) {
      rt = get(name, "route")
      if (rt !~ /^[A-Za-z0-9_-]+$/) { err(where " has an invalid route. Use letters, digits, \"_\" and \"-\" only."); continue }
      if (rt in reserved_route) { err(where " uses the reserved route \"" rt "\"."); continue }
      if (rt in seen_route) { err(where " repeats the route \"" rt "\"."); continue }
      seen_route[rt] = 1
    }
    any = 0
    for (i = 1; i <= nproto; i++) if ((proto[i] in enabled) && enabled[proto[i]] == 1) any = 1
    if (!any) { err(where " enables no protocol. Add an `rtsp:`, `onvif:` or `tapo:` block."); continue }

    entry = ""
    first_stream = nstreams + 1
    for (i = 1; i <= nproto; i++) {
      p = proto[i]
      if (!((p in enabled) && enabled[p] == 1)) continue
      user = has(name, p ".username") ? get(name, p ".username") : (has(name, "username") ? get(name, "username") : "")
      pass = has(name, p ".password") ? get(name, p ".password") : (has(name, "password") ? get(name, "password") : "")

      if (p == "rtsp") {
        port = has(name, "rtsp.port") ? get(name, "rtsp.port") : "554"
        path = has(name, "rtsp.path") ? get(name, "rtsp.path") : ""
        if (path == "") err(where " needs `rtsp.path`.")
        if (user == "") { err(where " needs `username`."); continue }
        if (pass == "") { err(where " needs `password`."); continue }
        if (path == "") continue
        base = "rtsp://" auth(user, pass) "@" host ":" port
        sid[++nstreams] = name ".rtsp"; surl[nstreams] = base path
        block = "\"rtsp\": {\"main\": " jq(name ".rtsp")
        if (has(name, "rtsp.sub_path")) { sid[++nstreams] = name ".rtsp.sub"; surl[nstreams] = base get(name, "rtsp.sub_path"); block = block ", \"sub\": " jq(name ".rtsp.sub") }
        block = block "}"
      } else if (p == "onvif") {
        port = has(name, "onvif.port") ? get(name, "onvif.port") : "80"
        if (user == "") { err(where " needs `username`."); continue }
        if (pass == "") { err(where " needs `password`."); continue }
        base = "onvif://" auth(user, pass) "@" host ":" port
        sid[++nstreams] = name ".onvif"
        surl[nstreams] = has(name, "onvif.profile") ? base "?subtype=" get(name, "onvif.profile") : base
        block = "\"onvif\": {\"main\": " jq(name ".onvif")
        if (has(name, "onvif.sub_profile")) { sid[++nstreams] = name ".onvif.sub"; surl[nstreams] = base "?subtype=" get(name, "onvif.sub_profile"); block = block ", \"sub\": " jq(name ".onvif.sub") }
        block = block "}"
      } else {
        tuser = has(name, "tapo.username") ? get(name, "tapo.username") : ""
        tpass = has(name, "tapo.password") ? get(name, "tapo.password") : ""
        if (tpass == "") { err(where " needs `tapo.password`. Tapo uses the TP-Link cloud password, which is not the RTSP password."); continue }
        sid[++nstreams] = name ".tapo"; surl[nstreams] = "tapo://" auth(tuser, tpass) "@" host
        block = "\"tapo\": {\"main\": " jq(name ".tapo") "}"
      }
      entry = entry (entry == "" ? "" : ", ") block
    }
    if (entry == "") continue
    cam_name[++ncams] = name
    cam_index[name] = ncams
    cam_first[ncams] = first_stream
    cam_last[ncams] = nstreams
    cam_label[ncams] = has(name, "label") ? get(name, "label") : label_of(name)
    cam_route[ncams] = has(name, "route") ? get(name, "route") : ""
    cam_entry[ncams] = entry
  }

  if (nerr > 0) {
    for (i = 1; i <= nerr; i++) printf "error: %s\n", errs[i] > "/dev/stderr"
    printf "Wrote no files. Correct %d problem(s) in cameras.ini.\n", nerr > "/dev/stderr"
    exit 1
  }

  if (nallow == 0) { for (i = 1; i <= ndefault_allow; i++) allow[++nallow] = default_allow[i] }
  allow_list = ""
  for (i = 1; i <= nallow; i++) allow_list = allow_list (i > 1 ? ", " : "") yq(allow[i])

  for (i = 1; i <= ncams; i++) pick[i] = i
  write_server(out, listen, static_dir, viewer, secret, allow_list, ":8555", ncams, 1)

  nviews = 0
  for (s = 1; s <= nsec; s++) {
    vname = secname[s]
    if (index(vname, "view:") != 1) continue
    vshort = substr(vname, 6)
    vwhere = "view \"" vshort "\""
    if (vshort !~ /^[A-Za-z0-9_-]+$/) { err("invalid view name \"" vshort "\". Use letters, digits, \"_\" and \"-\"."); continue }
    for (i = 1; i <= nkeys[vname]; i++) {
      k = keys[vname, i]
      if (!(k in view_key)) { err("line " vline[vname, k] ": unknown key \"" k "\" in [" vname "]"); continue }
      if (get(vname, k) == "") { err("line " vline[vname, k] ": \"" k "\" has no value"); continue }
    }
    vlisten = has(vname, "listen") ? get(vname, "listen") : ""
    if (vlisten == "") { err(vwhere " needs `listen`, for example \":8080\"."); continue }
    if (vlisten == listen || (vlisten in used_listen)) { err(vwhere " listens on " vlisten ", which another server already uses."); continue }
    used_listen[vlisten] = 1
    vpass = has(vname, "password") ? get(vname, "password") : ""
    if (vpass == "") { err(vwhere " needs `password`."); continue }
    vuser = has(vname, "username") ? get(vname, "username") : "viewer"
    vwebrtc = has(vname, "webrtc") ? get(vname, "webrtc") : sprintf(":%d", 8556 + nviews)
    vallow = allow_list
    if (has(vname, "allow_paths")) {
      m = split(get(vname, "allow_paths"), raw, ",")
      vallow = ""
      for (i = 1; i <= m; i++) { c = trim(raw[i]); if (c != "") vallow = vallow (vallow == "" ? "" : ", ") yq(c) }
    }
    if (!has(vname, "cameras")) { err(vwhere " needs `cameras`, a comma separated list of camera names."); continue }
    m = split(get(vname, "cameras"), raw, ",")
    nsel = 0; missing = ""
    for (i = 1; i <= m; i++) {
      c = trim(raw[i]); if (c == "") continue
      if (!(c in cam_index)) { missing = missing (missing == "" ? "" : ", ") c; continue }
      pick[++nsel] = cam_index[c]
    }
    if (missing != "") { err(vwhere " names no such camera: " missing); continue }
    if (nsel == 0) { err(vwhere " needs `cameras`, a comma separated list of camera names."); continue }
    vdir = out "/views/" vshort
    system("mkdir -p " vdir)
    write_server(vdir, vlisten, "www", vuser, vpass, vallow, vwebrtc, nsel, 0)
    view_names[++nviews] = vshort
  }

  if (nerr > 0) {
    for (i = 1; i <= nerr; i++) printf "error: %s\n", errs[i] > "/dev/stderr"
    printf "Wrote no files. Correct %d problem(s) in cameras.ini.\n", nerr > "/dev/stderr"
    exit 1
  }

  vfile = out "/views.txt"
  printf "" > vfile
  for (i = 1; i <= nviews; i++) printf "%s\n", view_names[i] > vfile
  close(vfile)
}

function write_server(dir, lst, sdir, usr, pwd, allows, wrtc, count, all,   i, j, k, idx, yfile, jfile, m, blocks, piece, pname, inner, kv, n2, b, x) {
  yfile = dir "/go2rtc.yaml"
  printf "streams:\n" > yfile
  for (j = 1; j <= count; j++) {
    idx = pick[j]
    for (k = cam_first[idx]; k <= cam_last[idx]; k++) printf "  %s: %s\n", sid[k], yq(surl[k]) > yfile
  }
  printf "api:\n" > yfile
  printf "  listen: %s\n", yq(lst) > yfile
  printf "  static_dir: %s\n", yq(sdir) > yfile
  printf "  allow_paths: [%s]\n", allows > yfile
  printf "  username: %s\n", yq(usr) > yfile
  printf "  password: %s\n", yq(pwd) > yfile
  printf "webrtc:\n  listen: %s\n  ice_servers: []\n", yq(wrtc) > yfile
  if (ncand > 0) { printf "  candidates:\n" > yfile; for (i = 1; i <= ncand; i++) printf "    - %s\n", yq(cand[i]) > yfile }
  close(yfile)

  jfile = dir "/cameras.json"
  if (count == 0) { printf "{\n  \"cameras\": []\n}\n" > jfile; close(jfile); return }
  printf "{\n  \"cameras\": [\n" > jfile
  for (j = 1; j <= count; j++) {
    i = pick[j]
    printf "    {\n      \"name\": %s,\n      \"label\": %s,\n", jq(cam_name[i]), jq(cam_label[i]) > jfile
    if (cam_route[i] != "") printf "      \"route\": %s,\n", jq(cam_route[i]) > jfile
    printf "      \"streams\": {\n" > jfile
    m = split(cam_entry[i], blocks, "}, \"")
    for (b = 1; b <= m; b++) {
      piece = blocks[b]
      if (b > 1) piece = "\"" piece
      if (b < m) piece = piece "}"
      pname = piece; sub(/^"/, "", pname); sub(/".*/, "", pname)
      inner = piece; sub(/^"[a-z]+": \{/, "", inner); sub(/\}$/, "", inner)
      n2 = split(inner, kv, ", ")
      printf "        \"%s\": {\n", pname > jfile
      for (x = 1; x <= n2; x++) printf "          %s%s\n", kv[x], (x < n2 ? "," : "") > jfile
      printf "        }%s\n", (b < m ? "," : "") > jfile
    }
    printf "      }\n    }%s\n", (j < count ? "," : "") > jfile
  }
  printf "  ]\n}\n" > jfile
  close(jfile)
}
