# Merge a freshly scanned cameras.ini into an existing one.
# usage: awk -f merge-ini.awk existing.ini candidate.ini
# Existing content is reproduced verbatim. A scanned camera is appended only when
# its host does not already appear, so renamed sections and hand-edited keys survive.
# It reports what it did on stderr.

function trim(s) { sub(/\r$/, "", s); sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

function section_name(line,   name) {
  name = line
  sub(/^[ \t]*\[/, "", name)
  sub(/\][ \t]*$/, "", name)
  return trim(name)
}

function flush_candidate(   i, name, suffix, counter) {
  if (buf_section == "" || buf_section == "server") { buf_n = 0; return }
  if (buf_host != "" && (buf_host in have_host)) {
    skipped++
    printf "  kept   %s (already present as [%s])\n", buf_host, have_host[buf_host] > "/dev/stderr"
    buf_n = 0
    return
  }
  name = buf_section
  if (name in have_name) {
    suffix = buf_host
    gsub(/[^A-Za-z0-9]/, "_", suffix)
    name = buf_section "_" suffix
    counter = 2
    while (name in have_name) { name = buf_section "_" suffix "_" counter; counter++ }
  }
  have_name[name] = 1
  if (buf_host != "") have_host[buf_host] = name
  out[++out_n] = ""
  out[++out_n] = "[" name "]"
  for (i = 1; i <= buf_n; i++) out[++out_n] = buf[i]
  added++
  printf "  added  %s as [%s]\n", buf_host, name > "/dev/stderr"
  buf_n = 0
}

FNR == NR {
  line = trim($0)
  if (line ~ /^\[[^]]+\]$/) {
    cur = section_name(line)
    have_name[cur] = 1
    existing_sections++
  } else if (cur != "" && cur != "server") {
    eq = index(line, "=")
    if (eq > 0) {
      key = trim(substr(line, 1, eq - 1))
      if (key == "host") have_host[trim(substr(line, eq + 1))] = cur
    }
  }
  body[++body_n] = $0
  next
}

{
  line = trim($0)
  if (line ~ /^\[[^]]+\]$/) {
    flush_candidate()
    buf_section = section_name(line)
    buf_host = ""
    next
  }
  if (buf_section == "" || buf_section == "server") next
  if (line == "") next
  eq = index(line, "=")
  if (eq > 0) {
    key = trim(substr(line, 1, eq - 1))
    if (key == "host") buf_host = trim(substr(line, eq + 1))
  }
  buf[++buf_n] = line
}

END {
  flush_candidate()
  for (i = 1; i <= body_n; i++) {
    if (i == body_n && body[i] == "") continue
    print body[i]
  }
  for (i = 1; i <= out_n; i++) print out[i]
  printf "Merged: %d camera(s) already present, %d added.\n", skipped + 0, added + 0 > "/dev/stderr"
}
