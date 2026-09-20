import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { parseArgs, promisify } from "node:util";
import {
  buildCameras,
  buildGo2rtcConfig,
  emitGo2rtcYaml,
  manifestJson,
} from "./lib/config-model.mjs";

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
  'xmlns:trt="http://www.onvif.org/ver10/media/wsdl" ' +
  'xmlns:tt="http://www.onvif.org/ver10/schema" ' +
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
  --write-config <file>
                       Write a cameras.ini for the cameras that were found.
                       Use "-" for stdout. It never overwrites an existing file.
  --write-runtime <dir>
                       Write go2rtc.yaml and cameras.json straight into <dir>.
                       This needs no cameras.ini and no parser.
  --force              Allow --write-runtime to replace an existing go2rtc.yaml.
  --help               Show this text.

Environment:
  ONVIF_USER, ONVIF_PASSWORD
      Optional. The script uses them for GetDeviceInformation on cameras that
      reject the anonymous call. Tapo cameras need them to show the model.
      With --write-config it also reads the stream paths over ONVIF, tries
      authenticated RTSP, and writes the account into the file.
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
        "write-config": { type: "string" },
        "write-runtime": { type: "string" },
        force: { type: "boolean" },
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
    writeConfig: values["write-config"] ?? null,
    writeRuntime: values["write-runtime"] ?? null,
    force: values.force === true,
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

function tagBlocks(xml, tag) {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${tag}((?:\\s[^>]*)?)>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`,
    "g",
  );
  return [...xml.matchAll(pattern)].map((match) => ({ attrs: match[1], body: match[2] }));
}

function attribute(attrs, name) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs ?? "");
  return match ? match[1] : null;
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
  if (info) return { url, auth: "open", credentialsAccepted: null, timeOffset: 0, ...info };
  const denied =
    res.status === 401 ||
    /NotAuthorized|FailedAuthentication|Unauthorized|not authorized|authentication/i.test(res.body);
  if (!denied) {
    const reason = tagText(res.body, "Text") || `HTTP ${res.status}`;
    return { url, auth: "unknown", credentialsAccepted: null, timeOffset: 0, ...empty, error: reason };
  }
  const result = { url, auth: "required", credentialsAccepted: null, timeOffset: 0, ...empty };
  if (!credentials) return result;
  const offset = await deviceTimeOffset(url, timeout);
  result.timeOffset = offset;
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

async function mediaServiceUrl(deviceUrl, credentials, offset, timeout) {
  const header = credentials ? securityHeader(credentials, offset) : "";
  const res = await soapCall(
    deviceUrl,
    "<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>",
    header,
    timeout,
  );
  if (!res || res.status !== 200) return deviceUrl;
  const media = tagBlock(res.body, "Media");
  const xaddr = media ? tagText(media, "XAddr") : "";
  return xaddr || deviceUrl;
}

function parseProfile(profile) {
  const token = attribute(profile.attrs, "token");
  if (!token) return null;
  const encoder = tagBlock(profile.body, "VideoEncoderConfiguration");
  const resolution = encoder ? tagBlock(encoder, "Resolution") : "";
  const width = Number(resolution ? tagText(resolution, "Width") : 0);
  const height = Number(resolution ? tagText(resolution, "Height") : 0);
  return {
    token,
    name: tagText(profile.body, "Name") || token,
    encoding: (encoder ? tagText(encoder, "Encoding") : "") || null,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

async function fetchProfiles(mediaUrl, credentials, offset, timeout) {
  const header = credentials ? securityHeader(credentials, offset) : "";
  const res = await soapCall(mediaUrl, "<trt:GetProfiles/>", header, timeout);
  if (!res || res.status !== 200) return [];
  return tagBlocks(res.body, "Profiles")
    .map(parseProfile)
    .filter((profile) => profile !== null);
}

async function fetchStreamUri(mediaUrl, token, credentials, offset, timeout) {
  const header = credentials ? securityHeader(credentials, offset) : "";
  const body =
    "<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream>" +
    "<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup>" +
    `<trt:ProfileToken>${escapeXml(token)}</trt:ProfileToken></trt:GetStreamUri>`;
  const res = await soapCall(mediaUrl, body, header, timeout);
  if (!res || res.status !== 200) return null;
  const uri = tagText(res.body, "Uri");
  if (!uri) return null;
  try {
    const parsed = new URL(uri);
    return {
      uri,
      port: Number(parsed.port) || 554,
      path: `${parsed.pathname}${parsed.search}`,
    };
  } catch {
    return null;
  }
}

async function probeStreams(deviceUrl, credentials, offset, timeout) {
  const mediaUrl = await mediaServiceUrl(deviceUrl, credentials, offset, timeout);
  const profiles = await fetchProfiles(mediaUrl, credentials, offset, timeout);
  const video = profiles.filter((profile) => /h\.?26[45]/i.test(profile.encoding ?? ""));
  const usable = video.length > 0 ? video : profiles;
  if (usable.length === 0) return null;

  const ranked = [...usable].sort((a, b) => b.width * b.height - a.width * a.height);
  const wanted = ranked.length > 1 ? [ranked[0], ranked[ranked.length - 1]] : [ranked[0]];
  const streams = [];
  for (const profile of wanted) {
    const stream = await fetchStreamUri(mediaUrl, profile.token, credentials, offset, timeout);
    if (stream) streams.push({ ...profile, ...stream });
  }
  if (streams.length === 0) return null;
  return { mediaUrl, profiles: usable, main: streams[0], sub: streams[1] ?? null };
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

function authorizationHeader(challenge, method, uri, credentials) {
  if (!challenge || !credentials) return null;
  if (/^basic/i.test(challenge)) {
    const token = Buffer.from(`${credentials.user}:${credentials.password}`).toString("base64");
    return `Basic ${token}`;
  }
  if (!/^digest/i.test(challenge)) return null;
  const field = (name) => {
    const match = new RegExp(`${name}="([^"]*)"`, "i").exec(challenge);
    return match ? match[1] : null;
  };
  const realm = field("realm");
  const nonce = field("nonce");
  if (realm === null || nonce === null) return null;
  const md5 = (text) => createHash("md5").update(text).digest("hex");
  const ha1 = md5(`${credentials.user}:${realm}:${credentials.password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = md5(`${ha1}:${nonce}:${ha2}`);
  const opaque = field("opaque");
  return (
    `Digest username="${credentials.user}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uri}", response="${response}"${opaque ? `, opaque="${opaque}"` : ""}`
  );
}

function rtspRequest(host, port, method, path, timeout, authorization) {
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
          "User-Agent: ipcam-viewer-discover\r\nAccept: application/sdp\r\n" +
          (authorization ? `Authorization: ${authorization}\r\n` : "") +
          "\r\n",
      );
    });
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
      if (data.includes("\r\n\r\n")) finish(parseRtspResponse(data));
    });
  });
}

async function probeRtsp(host, port, timeout, credentials) {
  const options = await rtspRequest(host, port, "OPTIONS", "/", timeout);
  if (!options) {
    return {
      port,
      reachable: false,
      server: null,
      auth: "unknown",
      realm: null,
      openPath: null,
      authedPath: null,
      credentialsAccepted: null,
    };
  }
  const result = {
    port,
    reachable: true,
    server: options.headers.server ?? null,
    auth: "unknown",
    realm: null,
    openPath: null,
    authedPath: null,
    credentialsAccepted: null,
  };
  let challenge = null;
  if (options.status === 401) {
    result.auth = "required";
    challenge = options.headers["www-authenticate"] ?? null;
    result.realm = realmOf(challenge);
  }

  for (const path of RTSP_PATHS) {
    const uri = `rtsp://${host}:${port}${path}`;
    const header = challenge ? authorizationHeader(challenge, "DESCRIBE", uri, credentials) : null;
    const res = await rtspRequest(host, port, "DESCRIBE", path, timeout, header);
    if (!res) continue;
    if (res.headers.server && !result.server) result.server = res.headers.server;
    if (res.status === 401) {
      result.auth = "required";
      challenge = res.headers["www-authenticate"] ?? challenge;
      result.realm = realmOf(challenge) ?? result.realm;
      if (credentials && header) result.credentialsAccepted = false;
      if (!credentials) return result;
      continue;
    }
    if (res.status === 200) {
      if (header) {
        result.authedPath = path;
        result.credentialsAccepted = true;
      } else {
        result.auth = result.auth === "required" ? result.auth : "open";
        result.openPath = path;
      }
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
    streams: null,
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

  if (host.onvif && (host.onvif.auth === "open" || host.onvif.credentialsAccepted)) {
    host.streams = await probeStreams(
      host.onvif.url,
      options.credentials,
      host.onvif.timeOffset ?? 0,
      options.timeout,
    );
  }

  for (const port of RTSP_PORTS) {
    if (openPorts.has(port)) host.rtsp.push(await probeRtsp(ip, port, options.timeout, options.credentials));
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

function slug(text) {
  const cleaned = String(text ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return cleaned.slice(0, 40);
}

function userSetName(host) {
  const scopes = host.discovery?.scopes;
  const name = scopes?.name[0];
  if (!name) return null;
  const hardware = scopes.hardware[0] ?? "";
  const model = host.onvif?.model ?? "";
  const same = (other) => other && slug(other) === slug(name);
  if (same(hardware) || same(model)) return null;
  return name;
}

function cameraName(host, used) {
  const candidates = [
    userSetName(host),
    host.onvif?.model,
    host.discovery?.scopes.name[0],
    host.guess.brand,
  ];
  let base = "";
  for (const candidate of candidates) {
    base = slug(candidate);
    if (base) break;
  }
  if (!base) base = "camera";
  const octet = host.ip.split(".").pop();
  let name = base;
  if (used.has(name)) name = `${base}_${octet}`;
  let counter = 2;
  while (used.has(name)) {
    name = `${base}_${octet}_${counter}`;
    counter += 1;
  }
  used.add(name);
  return name;
}

function onvifPortOf(host) {
  if (!host.onvif) return null;
  try {
    const parsed = new URL(host.onvif.url);
    return Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
  } catch {
    return null;
  }
}

function rtspPlanFor(host) {
  if (host.streams) {
    return {
      source: "onvif",
      port: host.streams.main.port,
      path: host.streams.main.path,
      subPath: host.streams.sub && host.streams.sub.path !== host.streams.main.path
        ? host.streams.sub.path
        : null,
    };
  }
  const probed = host.rtsp.find((entry) => entry.authedPath || entry.openPath);
  if (probed) {
    return {
      source: probed.authedPath ? "rtsp probe with credentials" : "rtsp probe",
      port: probed.port,
      path: probed.authedPath ?? probed.openPath,
      subPath: null,
    };
  }
  const reachable = host.rtsp.find((entry) => entry.reachable);
  if (reachable) return { source: null, port: reachable.port, path: null, subPath: null };
  return null;
}

function planCameras(cameras, credentials) {
  const used = new Set();
  const notes = [];
  const entries = [];

  for (const host of cameras) {
    const plan = rtspPlanFor(host);
    const onvifPort = onvifPortOf(host);
    if (!plan && onvifPort === null) {
      notes.push(`${host.ip}: no RTSP and no ONVIF endpoint found. Left out.`);
      continue;
    }

    const name = cameraName(host, used);
    const label = userSetName(host);
    const entry = {
      name,
      host: host.ip,
      username: credentials ? credentials.user : "your_camera_account",
      password: credentials ? credentials.password : "your_camera_password",
    };
    if (label && slug(label) !== name) entry.label = label;

    if (plan && plan.path) {
      entry.rtsp = { port: plan.port, path: plan.path };
      if (plan.subPath) entry.rtsp.sub_path = plan.subPath;
      else notes.push(`${host.ip} (${name}): found one stream only. No sub_path.`);
    } else if (plan) {
      notes.push(
        `${host.ip} (${name}): RTSP answers on port ${plan.port}, but the path stayed unknown. ` +
          "Add rtsp.path yourself.",
      );
    }
    if (onvifPort !== null) {
      entry.onvif = { port: onvifPort };
      if (host.streams) {
        entry.onvif.profile = host.streams.main.token;
        if (host.streams.sub && host.streams.sub.token !== host.streams.main.token) {
          entry.onvif.sub_profile = host.streams.sub.token;
        }
      }
    }
    entries.push(entry);
  }

  if (!credentials) {
    notes.push("Set ONVIF_USER and ONVIF_PASSWORD to fill in the camera account, or edit the file.");
  }
  notes.push("Tapo needs the TP-Link cloud password. Add tapo.password yourself when you want it.");

  const server = {
    listen: ":80",
    username: "viewer",
    password: randomBytes(12).toString("base64url"),
  };
  return { entries, server, notes };
}


function iniValue(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");
}

function cameraConfigIni(plan) {
  const lines = ["[server]"];
  lines.push(`listen = ${iniValue(plan.server.listen)}`);
  lines.push(`username = ${iniValue(plan.server.username)}`);
  lines.push(`password = ${iniValue(plan.server.password)}`);
  for (const entry of plan.entries) {
    lines.push("", `[${entry.name}]`);
    if (entry.label) lines.push(`label = ${iniValue(entry.label)}`);
    lines.push(`host = ${iniValue(entry.host)}`);
    lines.push(`username = ${iniValue(entry.username)}`);
    lines.push(`password = ${iniValue(entry.password)}`);
    if (entry.rtsp) {
      lines.push(`rtsp.port = ${entry.rtsp.port}`);
      lines.push(`rtsp.path = ${iniValue(entry.rtsp.path)}`);
      if (entry.rtsp.sub_path) lines.push(`rtsp.sub_path = ${iniValue(entry.rtsp.sub_path)}`);
    }
    if (entry.onvif) {
      lines.push(`onvif.port = ${entry.onvif.port}`);
      if (entry.onvif.profile) lines.push(`onvif.profile = ${iniValue(entry.onvif.profile)}`);
      if (entry.onvif.sub_profile) lines.push(`onvif.sub_profile = ${iniValue(entry.onvif.sub_profile)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeRuntime(directory, plan) {
  const errors = [];
  const warnings = [];
  const { streams, manifest } = buildCameras(plan.entries, errors, warnings);
  if (errors.length > 0) return { errors, warnings, written: 0 };

  const api = {
    listen: plan.server.listen,
    static_dir: "www",
    username: plan.server.username,
    password: plan.server.password,
  };
  const config = buildGo2rtcConfig({ streams, api, candidates: [] });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "go2rtc.yaml"), emitGo2rtcYaml(config));
  const json = manifestJson(manifest);
  writeFileSync(join(directory, "cameras.json"), json);
  if (existsSync(join(directory, "www"))) writeFileSync(join(directory, "www", "cameras.json"), json);
  return { errors, warnings, written: manifest.length, streams: Object.keys(streams).length };
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
  if (host.streams) {
    const stream = (entry) => `${entry.name} ${entry.width}x${entry.height} ${entry.path}`;
    const parts = [stream(host.streams.main)];
    if (host.streams.sub) parts.push(stream(host.streams.sub));
    lines.push(`  streams    ${parts.join(", ")}`);
  }
  for (const rtsp of host.rtsp) {
    const parts = [`:${rtsp.port}`];
    if (!rtsp.reachable) {
      parts.push("port open, no RTSP answer");
    } else {
      parts.push(`auth ${rtsp.auth}`);
      if (rtsp.openPath) parts.push(`open path ${rtsp.openPath}`);
      if (rtsp.authedPath) parts.push(`path ${rtsp.authedPath} with credentials`);
      if (rtsp.credentialsAccepted === false) parts.push("ONVIF_USER/ONVIF_PASSWORD rejected");
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
  if (options.writeConfig && options.writeConfig !== "-" && existsSync(options.writeConfig))
    fail(`${options.writeConfig} already exists. Move it, or choose another path.`);
  if (
    options.writeRuntime &&
    !options.force &&
    existsSync(`${options.writeRuntime}/go2rtc.yaml`)
  )
    fail(`${options.writeRuntime}/go2rtc.yaml already exists. Pass --force to replace it.`);
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

  if (options.writeConfig || options.writeRuntime) {
    const plan = planCameras(cameras, options.credentials);
    const usable = plan.entries.filter((entry) => entry.rtsp || entry.onvif);

    if (options.writeConfig) {
      const text = cameraConfigIni(plan);
      if (options.writeConfig === "-") {
        process.stdout.write(text);
      } else {
        writeFileSync(options.writeConfig, text);
        log(`Wrote ${options.writeConfig} with ${plan.entries.length} camera(s).`);
      }
    }

    if (options.writeRuntime) {
      if (usable.length === 0) {
        log("error: found no camera with a usable stream. Wrote no runtime config.");
      } else {
        const result = writeRuntime(options.writeRuntime, { ...plan, entries: usable });
        if (result.errors.length > 0) {
          for (const problem of result.errors) log(`error: ${problem}`);
        } else {
          log(
            `Wrote ${options.writeRuntime}/go2rtc.yaml and cameras.json ` +
              `with ${result.written} camera(s) and ${result.streams} stream(s).`,
          );
          log(`Viewer login: ${plan.server.username} / ${plan.server.password}`);
        }
      }
    }

    for (const note of plan.notes) log(`note: ${note}`);
    if (options.credentials && (options.writeRuntime || options.writeConfig !== "-")) {
      log("The written files hold the camera account. Keep them out of version control.");
    }
    if (options.writeConfig === "-" && !options.writeRuntime) return;
  }

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
