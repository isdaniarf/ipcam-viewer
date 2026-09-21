export function parseIni(text) {
  const sections = [];
  const errors = [];
  let current = null;

  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    const line = raw.replace(/^[ \t]+|[ \t]+$/g, "");
    if (line === "" || line.startsWith(";") || line.startsWith("#")) return;

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = header[1].replace(/^[ \t]+|[ \t]+$/g, "");
      if (name === "") {
        errors.push(`line ${number}: empty [section] name`);
        return;
      }
      if (sections.some((section) => section.name === name)) {
        errors.push(`line ${number}: duplicate section [${name}]`);
      }
      current = { name, line: number, entries: new Map() };
      sections.push(current);
      return;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      errors.push(`line ${number}: expected \`key = value\` or a [section] header`);
      return;
    }
    if (!current) {
      errors.push(`line ${number}: a key appears before the first [section]`);
      return;
    }
    const key = line.slice(0, separator).replace(/[ \t]+$/, "");
    const value = line.slice(separator + 1).replace(/^[ \t]+/, "");
    if (!/^[A-Za-z0-9_.]+$/.test(key)) {
      errors.push(`line ${number}: invalid key "${key}". Use letters, digits, "_" and "."`);
      return;
    }
    if (current.entries.has(key)) {
      errors.push(`line ${number}: duplicate key "${key}" in [${current.name}]`);
      return;
    }
    current.entries.set(key, { value, line: number });
  });

  return { sections, errors };
}

export function looksLikeOldYaml(text) {
  return /^(server|cameras):[ \t]*$/m.test(text) && !/^\[[^\]]+\]$/m.test(text);
}
