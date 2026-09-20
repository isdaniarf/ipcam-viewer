import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { parseArgs, promisify } from "node:util";

const exec = promisify(execFile);

const MULTICAST_ADDRESS = "239.255.255.250";
const MULTICAST_PORT = 3702;
const PROBE_TYPES = ["dn:NetworkVideoTransmitter", "tds:Device"];
const DEFAULT_PORTS = [80, 443, 554, 2020, 8000, 8080, 8443, 8554, 8899];
const ONVIF_PORTS = [2020, 80, 8080, 8899, 8000];
const RTSP_PORTS = [554, 8554];
const HTTP_PORTS = [80, 8080, 8000, 8899];
const HTTPS_PORTS = [443, 8443];
const RTSP_PATHS = [
  "/",
  "/stream1",
  "/live",
  "/h264Preview_01_main",
  "/cam/realmonitor?channel=1&subtype=0",
  "/Streaming/Channels/101",
  "/onvif1",
  "/live/ch00_0",
  "/videoMain",
  "/axis-media/media.amp",
  "/ch0_0.h264",
  "/11",
];
const BRAND_PATTERNS = [
  [/tp-?link|tapo|vigi/i, "TP-Link"],
  [/hikvision|hik-?connect|\bds-2[a-z]{2}/i, "Hikvision"],
  [/amcrest/i, "Amcrest"],
  [/lorex/i, "Lorex"],
  [/imou/i, "Imou"],
  [/dahua|\bdh-|\bipc-h/i, "Dahua"],
  [/reolink/i, "Reolink"],
  [/\baxis\b/i, "Axis"],
  [/ubnt|ubiquiti|unifi/i, "Ubiquiti"],
  [/foscam/i, "Foscam"],
  [/wyze/i, "Wyze"],
  [/ezviz/i, "EZVIZ"],
  [/uniview|\bunv\b/i, "Uniview"],
  [/annke/i, "Annke"],
  [/eufy|anker/i, "Eufy"],
  [/arlo/i, "Arlo"],
  [/vivotek/i, "Vivotek"],
  [/hanwha|wisenet|techwin/i, "Hanwha"],
  [/bosch/i, "Bosch"],
  [/geovision/i, "GeoVision"],
  [/xiaomi|mijia/i, "Xiaomi"],
  [/hipcam|hi35\d\d|goahead|xmeye|netsurveillance|jufeng/i, "Generic HiSilicon / XMEye"],
  [/go2rtc|mediamtx|rtsp-simple-server|frigate|live555/i, "Software RTSP server"],
];
const SOAP_NAMESPACES =
  'xmlns:s="http://www.w3.org/2003/05/soap-envelope" ' +
  'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" ' +
  'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" ' +
  'xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"';
const PASSWORD_DIGEST =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest";
const NONCE_ENCODING =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";
const VENDOR_API = "https://api.maclookup.app/v2/macs/";

const HELP = `Usage: node scripts/discover-cameras.mjs [options]

Finds IP cameras on the LAN with an ONVIF WS-Discovery probe and a TCP port sweep.

Options:
  --subnet <cidr>      Subnet to sweep. Repeat the option for more subnets.
                       Default: each local IPv4 subnet with a prefix between /22 and /30.
  --ports <list>       Ports to sweep, comma separated. Default: ${DEFAULT_PORTS.join(",")}
  --timeout <ms>       Timeout for one TCP connect or one request. Default: 1000
  --wait <ms>          Time to collect WS-Discovery answers. Default: 3000
  --concurrency <n>    Parallel TCP connects in the sweep. Default: 256
  --skip-discovery     Send no WS-Discovery probe.
  --skip-sweep         Sweep no ports. Inspect only the hosts that answer the probe.
  --offline            Look up no MAC vendor online.
  --json               Print the result as JSON.
  --help               Show this text.

Environment:
  ONVIF_USER, ONVIF_PASSWORD
      Optional. The script uses them for GetDeviceInformation on cameras that
      reject the anonymous call. Tapo cameras need them to show the model.
`;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        subnet: { type: "string", multiple: true },
        ports: { type: "string" },
        timeout: { type: "string" },
        wait: { type: "string" },
        concurrency: { type: "string" },
        "skip-discovery": { type: "boolean" },
        "skip-sweep": { type: "boolean" },
        offline: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
  } catch (error) {
    fail(error.message);
  }
  const values = parsed.values;
  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const number = (name, fallback) => {
    if (values[name] === undefined) return fallback;
    const value = Number(values[name]);
    if (!Number.isInteger(value) || value <= 0) fail(`--${name} must be a positive integer.`);
    return value;
  };
  const ports = values.ports
    ? values.ports.split(",").map((text) => {
        const port = Number(text.trim());
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          fail(`--ports has an invalid port "${text}".`);
        return port;
      })
    : DEFAULT_PORTS;
  const subnets = (values.subnet ?? []).map((text) => {
    const cidr = parseCidr(text);
    if (!cidr) fail(`--subnet "${text}" is not a CIDR like 192.168.1.0/24.`);
    if (cidr.bits < 16) fail(`--subnet "${text}" is too large. Use a prefix of /16 or longer.`);
    return cidr;
  });
  const user = process.env.ONVIF_USER;
  const password = process.env.ONVIF_PASSWORD;
  if ((user && !password) || (!user && password))
    fail("Set both ONVIF_USER and ONVIF_PASSWORD, or set neither.");
  return {
    subnets,
    ports: unique(ports),
    timeout: number("timeout", 1000),
    wait: number("wait", 3000),
    concurrency: number("concurrency", 256),
    skipDiscovery: values["skip-discovery"] === true,
    skipSweep: values["skip-sweep"] === true,
    offline: values.offline === true,
    json: values.json === true,
    credentials: user ? { user, password } : null,
  };
}

function unique(list) {
  return [...new Set(list)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function log(message) {
  process.stderr.write(`${message}\n`);
}

function progress(message) {
  if (!process.stderr.isTTY) return;
  process.stderr.write(`\r\x1b[2K${message}`);
}

function ipToInt(ip) {
  return ip.split(".").reduce((total, octet) => total * 256 + Number(octet), 0);
}

function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function parseCidr(text) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const bits = Number(match[5]);
  if (octets.some((octet) => octet > 255) || bits > 32) return null;
  return { text, base: octets.join("."), bits };
}

function cidrHosts(cidr) {
  const mask = cidr.bits === 0 ? 0 : (0xffffffff << (32 - cidr.bits)) >>> 0;
  const network = (ipToInt(cidr.base) & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const first = cidr.bits >= 31 ? network : network + 1;
  const last = cidr.bits >= 31 ? broadcast : broadcast - 1;
  const hosts = [];
  for (let value = first; value <= last; value += 1) hosts.push(intToIp(value));
  return hosts;
}

function localInterfaces() {
  const list = [];
  for (const [name, group] of Object.entries(networkInterfaces())) {
    for (const entry of group ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      const cidr = parseCidr(entry.cidr ?? "");
      if (!cidr) continue;
      list.push({ name, address: entry.address, cidr });
    }
  }
  return list.filter((entry) => entry.cidr.bits >= 22 && entry.cidr.bits <= 30);
}

function checkPort(host, port, timeout) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function sweepPorts(hosts, ports, options) {
  const tasks = [];
  for (const host of hosts) for (const port of ports) tasks.push({ host, port });
  const open = new Map();
  let done = 0;
  await mapLimit(tasks, options.concurrency, async ({ host, port }) => {
    if (await checkPort(host, port, options.timeout)) {
      if (!open.has(host)) open.set(host, new Set());
      open.get(host).add(port);
    }
    done += 1;
    if (done % 50 === 0 || done === tasks.length) {
      progress(`sweep: ${done}/${tasks.length} checks, ${open.size} host(s) with an open port`);
    }
  });
  progress("");
  return open;
}

function probeMessage(types) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" ' +
    'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ' +
    'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ' +
    'xmlns:dn="http://www.onvif.org/ver10/network/wsdl" ' +
    'xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
    `<e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID>` +
    '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
    '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>' +
    `</e:Header><e:Body><d:Probe><d:Types>${types}</d:Types></d:Probe></e:Body></e:Envelope>`
  );
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tagText(xml, tag) {
  const match = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([^<]*)<`).exec(xml);
  return match ? decodeEntities(match[1].trim()) : "";
}

function tagBlock(xml, tag) {
  const match = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`).exec(
    xml,
  );
  return match ? match[1] : "";
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseScopes(scopes) {
  const info = { name: [], hardware: [], location: [], profiles: [] };
  for (const scope of scopes) {
    const match = /^onvif:\/\/www\.onvif\.org\/([^/]+)\/(.+)$/i.exec(scope);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = safeDecode(match[2]);
    if (key === "name") info.name.push(value);
    if (key === "hardware") info.hardware.push(value);
    if (key === "location") info.location.push(value);
    if (key === "profile") info.profiles.push(value);
  }
  return info;
}

function recordProbeMatch(found, xml, address) {
  if (!xml.includes("ProbeMatch")) return;
  const split = (text) => text.split(/\s+/).filter(Boolean);
  const previous = found.get(address) ?? { xaddrs: [], scopes: [], types: [] };
  found.set(address, {
    xaddrs: unique([...previous.xaddrs, ...split(tagText(xml, "XAddrs"))]),
    scopes: unique([...previous.scopes, ...split(tagText(xml, "Scopes"))]),
    types: unique([...previous.types, ...split(tagText(xml, "Types"))]),
  });
}

async function discover(interfaces, wait) {
  const found = new Map();
  const sockets = [];
  for (const iface of interfaces) {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    try {
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(0, iface.address, () => {
          socket.removeListener("error", reject);
          resolve();
        });
      });
      socket.setMulticastInterface(iface.address);
    } catch (error) {
      log(`warning: WS-Discovery cannot use ${iface.name} (${iface.address}): ${error.message}`);
      socket.close();
      continue;
    }
    socket.on("error", (error) => log(`warning: WS-Discovery socket on ${iface.name}: ${error.message}`));
    socket.on("message", (message, rinfo) =>
      recordProbeMatch(found, message.toString("utf-8"), rinfo.address),
    );
    sockets.push(socket);
  }
  if (sockets.length === 0) return found;
  const send = () => {
    for (const socket of sockets) {
      for (const types of PROBE_TYPES) {
        socket.send(probeMessage(types), MULTICAST_PORT, MULTICAST_ADDRESS, () => {});
      }
    }
  };
  send();
  await sleep(Math.min(wait, 1000));
  send();
  await sleep(Math.max(wait - 1000, 0));
  for (const socket of sockets) socket.close();
  return found;
}

function httpCall(url, { method = "GET", headers = {}, body, timeout }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let target;
    try {
      target = new URL(url);
    } catch {
      finish(null);
      return;
    }
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const allHeaders = { Connection: "close", "User-Agent": "ipcam-viewer-discover", ...headers };
    if (body !== undefined) allHeaders["Content-Length"] = Buffer.byteLength(body);
    const req = request(
      target,
      { method, headers: allHeaders, timeout, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        let size = 0;
        const done = () =>
          finish({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        res.on("data", (chunk) => {
          if (size >= 65536) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        res.once("end", done);
        res.once("close", done);
        res.once("error", done);
      },
    );
    req.once("timeout", () => req.destroy(new Error("timeout")));
    req.once("error", () => finish(null));
    req.end(body);
  });
}

function realmOf(header) {
  const match = /realm="([^"]*)"/i.exec(header ?? "");
  return match ? match[1] : null;
}

function envelope(action, header) {
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope ${SOAP_NAMESPACES}>${header}<s:Body>${action}</s:Body></s:Envelope>`;
}

function securityHeader(credentials, offset) {
  const nonce = randomBytes(16);
  const created = new Date(Date.now() + offset).toISOString();
  const digest = createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(credentials.password)]))
    .digest("base64");
  return (
    '<s:Header><wsse:Security s:mustUnderstand="1"><wsse:UsernameToken>' +
    `<wsse:Username>${escapeXml(credentials.user)}</wsse:Username>` +
    `<wsse:Password Type="${PASSWORD_DIGEST}">${digest}</wsse:Password>` +
    `<wsse:Nonce EncodingType="${NONCE_ENCODING}">${nonce.toString("base64")}</wsse:Nonce>` +
    `<wsu:Created>${created}</wsu:Created>` +
    "</wsse:UsernameToken></wsse:Security></s:Header>"
  );
}

function soapCall(url, action, header, timeout) {
  return httpCall(url, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
    body: envelope(action, header),
    timeout,
  });
}

async function deviceTimeOffset(url, timeout) {
  const res = await soapCall(url, "<tds:GetSystemDateAndTime/>", "", timeout);
  if (!res) return 0;
  const block = tagBlock(res.body, "UTCDateTime");
  if (!block) return 0;
  const field = (tag) => Number(tagText(block, tag));
  const deviceTime = Date.UTC(
    field("Year"),
    field("Month") - 1,
    field("Day"),
    field("Hour"),
    field("Minute"),
    field("Second"),
  );
  return Number.isFinite(deviceTime) ? deviceTime - Date.now() : 0;
}

function parseDeviceInformation(xml) {
  const manufacturer = tagText(xml, "Manufacturer");
  const model = tagText(xml, "Model");
  if (!manufacturer && !model) return null;
  return {
    manufacturer: manufacturer || null,
    model: model || null,
    firmware: tagText(xml, "FirmwareVersion") || null,
    serial: tagText(xml, "SerialNumber") || null,
    hardwareId: tagText(xml, "HardwareId") || null,
  };
}

async function probeOnvif(url, credentials, timeout, trusted) {
  const res = await soapCall(url, "<tds:GetDeviceInformation/>", "", timeout);
  if (!res) return null;
  const isSoap =
    res.body.includes("Envelope") || /soap\+xml|text\/xml/i.test(res.headers["content-type"] ?? "");
  if (!isSoap && !(trusted && res.status === 401)) return null;
  const empty = { manufacturer: null, model: null, firmware: null, serial: null, hardwareId: null };
  const info = parseDeviceInformation(res.body);
  if (info) return { url, auth: "open", credentialsAccepted: null, ...info };
  const denied =
    res.status === 401 ||
    /NotAuthorized|FailedAuthentication|Unauthorized|not authorized|authentication/i.test(res.body);
  if (!denied) {
    const reason = tagText(res.body, "Text") || `HTTP ${res.status}`;
    return { url, auth: "unknown", credentialsAccepted: null, ...empty, error: reason };
  }
  const result = { url, auth: "required", credentialsAccepted: null, ...empty };
  if (!credentials) return result;
  const offset = await deviceTimeOffset(url, timeout);
  const authed = await soapCall(
    url,
    "<tds:GetDeviceInformation/>",
    securityHeader(credentials, offset),
    timeout,
  );
  const authedInfo = authed ? parseDeviceInformation(authed.body) : null;
  if (!authedInfo) return { ...result, credentialsAccepted: false };
  return { ...result, credentialsAccepted: true, ...authedInfo };
}

function pickXaddr(ip, xaddrs) {
  const urls = xaddrs.filter((text) => /^https?:\/\//i.test(text));
  const same = urls.find((text) => {
    try {
      return new URL(text).hostname === ip;
    } catch {
      return false;
    }
  });
  if (same) return same;
  if (urls.length === 0) return null;
  try {
    const first = new URL(urls[0]);
    return `${first.protocol}//${ip}${first.port ? `:${first.port}` : ""}${first.pathname}`;
  } catch {
    return null;
  }
}

function parseRtspResponse(text) {
  const [head] = text.split("\r\n\r\n");
  const lines = head.split("\r\n");
  const match = /^RTSP\/\d\.\d (\d{3})/.exec(lines[0]);
  if (!match) return null;
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return { status: Number(match[1]), headers };
}

function rtspRequest(host, port, method, path, timeout) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let data = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout, () => finish(data ? parseRtspResponse(data) : null));
    socket.once("error", () => finish(data ? parseRtspResponse(data) : null));
    socket.once("close", () => finish(data ? parseRtspResponse(data) : null));
    socket.once("connect", () => {
      socket.write(
        `${method} rtsp://${host}:${port}${path} RTSP/1.0\r\nCSeq: 1\r\n` +
          "User-Agent: ipcam-viewer-discover\r\nAccept: application/sdp\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
      if (data.includes("\r\n\r\n")) finish(parseRtspResponse(data));
    });
  });
}

async function probeRtsp(host, port, timeout) {
  const options = await rtspRequest(host, port, "OPTIONS", "/", timeout);
  if (!options) return { port, reachable: false, server: null, auth: "unknown", realm: null, openPath: null };
  const result = {
    port,
    reachable: true,
    server: options.headers.server ?? null,
    auth: "unknown",
    realm: null,
    openPath: null,
  };
  if (options.status === 401) {
    result.auth = "required";
    result.realm = realmOf(options.headers["www-authenticate"]);
    return result;
  }
  for (const path of RTSP_PATHS) {
    const res = await rtspRequest(host, port, "DESCRIBE", path, timeout);
    if (!res) continue;
    if (res.headers.server && !result.server) result.server = res.headers.server;
    if (res.status === 401) {
      result.auth = "required";
      result.realm = realmOf(res.headers["www-authenticate"]);
      return result;
    }
    if (res.status === 200) {
      result.auth = "open";
      result.openPath = path;
      return result;
    }
  }
  return result;
}

async function probeHttp(host, port, secure, timeout) {
  let url = `${secure ? "https" : "http"}://${host}:${port}/`;
  let res = null;
  for (let hop = 0; hop < 3; hop += 1) {
    res = await httpCall(url, { timeout });
    if (!res) return null;
    const location = res.headers.location;
    if (!(res.status >= 300 && res.status < 400 && location)) break;
    let next;
    try {
      next = new URL(location, url);
    } catch {
      break;
    }
    if (next.hostname !== host) break;
    url = next.href;
  }
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(res.body);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  const loginPage = /type=["']?password/i.test(res.body) || /login|sign in/i.test(title);
  const realm = realmOf(res.headers["www-authenticate"]);
  let auth = "unknown";
  if (res.status === 401) auth = "required";
  else if (res.status === 200) auth = loginPage ? "login page" : "no login seen";
  return {
    port,
    secure,
    url,
    status: res.status,
    server: res.headers.server ?? null,
    realm,
    title: title || null,
    auth,
    evidence: `${res.headers.server ?? ""} ${realm ?? ""} ${title} ${res.body.slice(0, 4096)}`,
  };
}

function normalizeMac(text) {
  return text
    .toLowerCase()
    .split(/[:-]/)
    .map((part) => part.padStart(2, "0"))
    .join(":");
}

function isLocallyAdministered(mac) {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return (first & 2) === 2;
}

async function arpTable() {
  const table = new Map();
  const add = (ip, mac) => {
    const value = normalizeMac(mac);
    if (value === "00:00:00:00:00:00" || value === "ff:ff:ff:ff:ff:ff") return;
    table.set(ip, value);
  };
  const tryCommand = async (command, args) => {
    try {
      const { stdout } = await exec(command, args, { maxBuffer: 4 * 1024 * 1024 });
      return stdout;
    } catch {
      return "";
    }
  };
  if (process.platform === "linux") {
    const neigh = await tryCommand("ip", ["neigh"]);
    for (const match of neigh.matchAll(/^(\d+\.\d+\.\d+\.\d+)\s.*\blladdr\s+([0-9a-f:]{11,17})/gim))
      add(match[1], match[2]);
    if (table.size > 0) return table;
  }
  const arp = await tryCommand("arp", ["-an"]);
  for (const match of arp.matchAll(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]{11,17})/gi))
    add(match[1], match[2]);
  for (const match of arp.matchAll(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})/gim))
    add(match[1], match[2]);
  return table;
}

async function lookupVendors(macs, timeout) {
  const vendors = new Map();
  const prefixes = unique(macs.map((mac) => mac.replace(/:/g, "").slice(0, 6).toUpperCase()));
  for (const [index, prefix] of prefixes.entries()) {
    if (index > 0) await sleep(600);
    let res = await httpCall(`${VENDOR_API}${prefix}`, { timeout: Math.max(timeout, 4000) });
    if (res && res.status === 429) {
      await sleep(2000);
      res = await httpCall(`${VENDOR_API}${prefix}`, { timeout: Math.max(timeout, 4000) });
    }
    if (!res || res.status !== 200) continue;
    try {
      const data = JSON.parse(res.body);
      vendors.set(prefix, data.found ? data.company : null);
    } catch {
      continue;
    }
  }
  return vendors;
}

function guessIdentity(host) {
  const evidence = [];
  if (host.onvif?.manufacturer) evidence.push(host.onvif.manufacturer);
  if (host.onvif?.model) evidence.push(host.onvif.model);
  if (host.discovery) evidence.push(...host.discovery.scopes.hardware, ...host.discovery.scopes.name);
  for (const rtsp of host.rtsp) evidence.push(rtsp.realm ?? "", rtsp.server ?? "");
  for (const web of host.http) evidence.push(web.realm ?? "", web.server ?? "", web.title ?? "");
  for (const web of host.http) evidence.push(web.evidence);
  if (host.vendor) evidence.push(host.vendor);

  let brand = null;
  for (const text of evidence) {
    if (!text) continue;
    const hit = BRAND_PATTERNS.find(([pattern]) => pattern.test(text));
    if (hit) {
      brand = hit[1];
      break;
    }
  }
  if (!brand && host.onvif?.manufacturer) brand = host.onvif.manufacturer;

  const model =
    host.onvif?.model ?? host.discovery?.scopes.hardware[0] ?? host.discovery?.scopes.name[0] ?? null;
  return { brand, model };
}

function likelyCamera(host) {
  if (host.discovery || host.onvif) return true;
  if (host.rtsp.some((rtsp) => rtsp.reachable)) return true;
  return host.ports.some((port) => RTSP_PORTS.includes(port) || port === 2020);
}

async function inspectHost(ip, openPorts, discovery, options) {
  const host = {
    ip,
    mac: null,
    macLocallyAdministered: false,
    vendor: null,
    ports: [...openPorts].sort((a, b) => a - b),
    discovery: discovery
      ? { xaddrs: discovery.xaddrs, types: discovery.types, scopes: parseScopes(discovery.scopes) }
      : null,
    onvif: null,
    rtsp: [],
    http: [],
  };

  const onvifUrls = [];
  if (discovery) {
    const xaddr = pickXaddr(ip, discovery.xaddrs);
    if (xaddr) onvifUrls.push({ url: xaddr, trusted: true });
  }
  for (const port of ONVIF_PORTS) {
    if (!openPorts.has(port)) continue;
    const url = `http://${ip}:${port}/onvif/device_service`;
    if (!onvifUrls.some((entry) => entry.url === url)) onvifUrls.push({ url, trusted: false });
  }
  for (const entry of onvifUrls) {
    host.onvif = await probeOnvif(entry.url, options.credentials, options.timeout, entry.trusted);
    if (host.onvif) break;
  }

  for (const port of RTSP_PORTS) {
    if (openPorts.has(port)) host.rtsp.push(await probeRtsp(ip, port, options.timeout));
  }
  for (const port of HTTP_PORTS) {
    if (!openPorts.has(port)) continue;
    const web = await probeHttp(ip, port, false, options.timeout);
    if (web) host.http.push(web);
  }
  for (const port of HTTPS_PORTS) {
    if (!openPorts.has(port)) continue;
    const web = await probeHttp(ip, port, true, options.timeout);
    if (web) host.http.push(web);
  }
  return host;
}

function authSummary(host) {
  const rtsp = host.rtsp.find((entry) => entry.reachable);
  const web =
    host.http.find((entry) => entry.auth === "required" || entry.auth === "login page") ?? host.http[0];
  return {
    onvif: host.onvif ? host.onvif.auth : null,
    rtsp: rtsp ? rtsp.auth : null,
    web: web ? web.auth : null,
  };
}

function renderHost(host) {
  const lines = [];
  let vendor = host.vendor ?? "";
  if (!vendor && host.mac)
    vendor = host.macLocallyAdministered ? "locally administered MAC" : "vendor unknown";
  lines.push([host.ip, host.mac ?? "mac unknown", vendor].filter(Boolean).join("  "));
  const guess = [host.guess.brand, host.guess.model].filter(Boolean).join(" ");
  lines.push(`  guess      ${guess || "unknown"}`);
  lines.push(`  ports      ${host.ports.length > 0 ? host.ports.join(" ") : "none from the sweep list"}`);
  if (host.discovery) {
    const scopes = host.discovery.scopes;
    const parts = [];
    if (scopes.name.length > 0) parts.push(`name=${scopes.name.join(",")}`);
    if (scopes.hardware.length > 0) parts.push(`hardware=${scopes.hardware.join(",")}`);
    if (scopes.location.length > 0) parts.push(`location=${scopes.location.join(",")}`);
    if (scopes.profiles.length > 0) parts.push(`profiles=${scopes.profiles.join(",")}`);
    lines.push(`  discovery  ${[host.discovery.xaddrs.join(" "), ...parts].join(", ")}`);
  }
  if (host.onvif) {
    const onvif = host.onvif;
    const parts = [onvif.url, `auth ${onvif.auth}`];
    const device = [onvif.manufacturer, onvif.model].filter(Boolean).join(" ");
    if (device) parts.push(device);
    if (onvif.firmware) parts.push(`firmware ${onvif.firmware}`);
    if (onvif.serial) parts.push(`serial ${onvif.serial}`);
    if (onvif.credentialsAccepted === false) parts.push("ONVIF_USER/ONVIF_PASSWORD rejected");
    if (onvif.error) parts.push(onvif.error);
    lines.push(`  onvif      ${parts.join(", ")}`);
  } else if (host.ports.some((port) => ONVIF_PORTS.includes(port))) {
    lines.push("  onvif      no answer on /onvif/device_service");
  }
  for (const rtsp of host.rtsp) {
    const parts = [`:${rtsp.port}`];
    if (!rtsp.reachable) {
      parts.push("port open, no RTSP answer");
    } else {
      parts.push(`auth ${rtsp.auth}`);
      if (rtsp.openPath) parts.push(`open path ${rtsp.openPath}`);
      if (rtsp.realm) parts.push(`realm "${rtsp.realm}"`);
      if (rtsp.server) parts.push(`server ${rtsp.server}`);
    }
    lines.push(`  rtsp       ${parts.join(", ")}`);
  }
  for (const web of host.http) {
    const parts = [`:${web.port}${web.secure ? " https" : ""}`, `HTTP ${web.status}`, `auth ${web.auth}`];
    if (web.title) parts.push(`"${web.title}"`);
    if (web.server) parts.push(`server ${web.server}`);
    if (web.realm) parts.push(`realm "${web.realm}"`);
    lines.push(`  web        ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

function renderOther(host) {
  const parts = [host.ip, host.mac ?? "mac unknown", host.vendor ?? "", `ports ${host.ports.join(" ")}`];
  if (host.guess.brand) parts.push(`(${host.guess.brand})`);
  return `  ${parts.filter(Boolean).join("  ")}`;
}

async function main() {
  const options = readOptions();
  const interfaces = localInterfaces();
  const subnets = options.subnets.length > 0 ? options.subnets : interfaces.map((entry) => entry.cidr);
  if (options.skipDiscovery && options.skipSweep)
    fail("--skip-discovery and --skip-sweep leave nothing to scan.");
  if (!options.skipSweep && subnets.length === 0) fail("Found no local subnet to sweep. Pass --subnet.");

  let discovered = new Map();
  if (!options.skipDiscovery) {
    if (interfaces.length === 0) {
      log("warning: found no LAN interface for WS-Discovery. Skipping the probe.");
    } else {
      const names = interfaces.map((entry) => `${entry.name} (${entry.address})`).join(", ");
      log(
        `WS-Discovery: probing ${MULTICAST_ADDRESS}:${MULTICAST_PORT} from ${names}, waiting ${options.wait} ms`,
      );
      discovered = await discover(interfaces, options.wait);
      log(`WS-Discovery: ${discovered.size} device(s) answered`);
    }
  }

  const ownAddresses = new Set(interfaces.map((entry) => entry.address));
  let openPorts = new Map();
  if (!options.skipSweep) {
    const hosts = unique(subnets.flatMap((cidr) => cidrHosts(cidr))).filter((ip) => !ownAddresses.has(ip));
    const cidrs = unique(subnets.map((cidr) => cidr.text)).join(", ");
    log(
      `Sweep: ${hosts.length} host(s) in ${cidrs}, ports ${options.ports.join(",")}, ` +
        `timeout ${options.timeout} ms, ${options.concurrency} parallel`,
    );
    openPorts = await sweepPorts(hosts, options.ports, options);
    log(`Sweep: ${openPorts.size} host(s) with an open port`);
  }

  const candidates = unique([...discovered.keys(), ...openPorts.keys()]).sort(
    (a, b) => ipToInt(a) - ipToInt(b),
  );
  if (candidates.length === 0) {
    log("Found no host.");
    if (options.json) process.stdout.write(`${JSON.stringify({ hosts: [] }, null, 2)}\n`);
    return;
  }

  log(`Inspecting ${candidates.length} host(s)`);
  const hosts = await mapLimit(candidates, 8, async (ip) => {
    let ports = openPorts.get(ip);
    if (!ports) {
      ports = new Set();
      for (const port of options.ports) {
        if (await checkPort(ip, port, options.timeout)) ports.add(port);
      }
    }
    return inspectHost(ip, ports, discovered.get(ip) ?? null, options);
  });

  const arp = await arpTable();
  for (const host of hosts) {
    const mac = arp.get(host.ip);
    if (!mac) continue;
    host.mac = mac;
    host.macLocallyAdministered = isLocallyAdministered(mac);
  }
  if (!options.offline) {
    const macs = hosts.filter((host) => host.mac && !host.macLocallyAdministered).map((host) => host.mac);
    if (macs.length > 0) {
      log(
        `Vendor lookup: sending ${unique(macs.map((mac) => mac.slice(0, 8))).length} MAC prefix(es) to ${VENDOR_API}`,
      );
      const vendors = await lookupVendors(macs, options.timeout);
      for (const host of hosts) {
        if (!host.mac) continue;
        host.vendor = vendors.get(host.mac.replace(/:/g, "").slice(0, 6).toUpperCase()) ?? null;
      }
    }
  }

  for (const host of hosts) {
    host.guess = guessIdentity(host);
    host.auth = authSummary(host);
    host.likelyCamera = likelyCamera(host);
    for (const web of host.http) delete web.evidence;
  }

  const cameras = hosts.filter((host) => host.likelyCamera);
  const others = hosts.filter((host) => !host.likelyCamera);

  if (options.json) {
    const output = {
      scannedAt: new Date().toISOString(),
      subnets: subnets.map((cidr) => cidr.text),
      hosts,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const out = [];
  out.push(`Likely cameras: ${cameras.length}`);
  for (const host of cameras) out.push("", renderHost(host));
  if (others.length > 0) {
    out.push("", `Other hosts with an open port: ${others.length}`);
    for (const host of others) out.push(renderOther(host));
  }
  out.push("");
  const needCredentials = cameras.some((host) => host.onvif?.auth === "required" && !host.onvif.model);
  if (needCredentials && !options.credentials) {
    out.push(
      'Set ONVIF_USER and ONVIF_PASSWORD to read the model from cameras with "auth required" on ONVIF.',
    );
  }
  process.stdout.write(`${out.join("\n")}\n`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exit(1);
});
