// Strict HTTPS URL validation and byte-capped fetching for importing shared
// `.fstheme.json` theme documents by URL.

import { MAX_THEME_FILE_BYTES } from './types';

export const MAX_THEME_IMPORT_URL_LENGTH = 2048;
export const THEME_URL_FETCH_TIMEOUT_MS = 10_000;

const TEXT_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export type ThemeUrlValidationResult =
  | { readonly ok: true; readonly url: string; readonly displayHost: string }
  | { readonly ok: false; readonly error: string };

export type ThemeUrlFetchResult =
  | { readonly ok: true; readonly text: string; readonly finalUrl: string }
  | { readonly ok: false; readonly error: string };

export type ThemeUrlFetcher = (url: string) => Promise<ThemeUrlFetchResult>;

function hasControlOrSpace(input: string): boolean {
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const ALLOWED_CONTENT_TYPE_RE =
  /^(?:application\/(?:[a-z0-9.+-]+\+)?json|text\/plain|application\/octet-stream)(?:$|\s*;)/i;
const HTML_CONTENT_TYPE_RE = /^(?:text\/html|application\/xhtml\+xml)(?:$|\s*;)/i;

const PRIVATE_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home.arpa',
  '.lan',
] as const;

function isNonPublicIpv4(octets: readonly [number, number, number, number]): boolean {
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8 ("this" network)
    a === 10 || // 10.0.0.0/8 (RFC 1918)
    a === 127 || // 127.0.0.0/8 (loopback)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local & cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (RFC 1918)
    (a === 192 && b === 168) || // 192.168.0.0/16 (RFC 1918)
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 (benchmarking)
    a >= 224 // multicast & reserved
  );
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const match = IPV4_RE.exec(host);
  if (!match) {
    return null;
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const;
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

function parseIpv6ToHextets(rawHost: string): number[] | null {
  const inner = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  // Strip any zone index (`%eth0`) just in case.
  const withoutZone = inner.split('%')[0] ?? '';
  if (!withoutZone) {
    return null;
  }
  // Convert trailing embedded IPv4 (e.g. `::ffff:127.0.0.1`) into two 16-bit hextets.
  let normalized = withoutZone.toLowerCase();
  const lastColon = normalized.lastIndexOf(':');
  if (lastColon !== -1 && normalized.includes('.')) {
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) {
      return null;
    }
    const hi = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const lo = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parseSide = (part: string): number[] | null => {
    if (!part) {
      return [];
    }
    const items = part.split(':');
    const out: number[] = [];
    for (const item of items) {
      if (!/^[\da-f]{1,4}$/.test(item)) {
        return null;
      }
      out.push(Number.parseInt(item, 16));
    }
    return out;
  };
  const left = parseSide(halves[0] ?? '');
  const right = halves.length === 2 ? parseSide(halves[1] ?? '') : [];
  if (!left || !right) {
    return null;
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    return null;
  }
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isNonPublicIpv6(rawHost: string): boolean {
  const hextets = parseIpv6ToHextets(rawHost);
  if (!hextets) {
    return true;
  }
  const isAllZeroPrefix = hextets.slice(0, 7).every((h) => h === 0);
  // `::` (unspecified) or `::1` (loopback)
  if (isAllZeroPrefix && (hextets[7] === 0 || hextets[7] === 1)) {
    return true;
  }
  const first = hextets[0] ?? 0;
  // fc00::/7 (unique local), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast)
  if (
    (first & 0xfe_00) === 0xfc_00 ||
    (first & 0xff_c0) === 0xfe_80 ||
    (first & 0xff_c0) === 0xfe_c0 ||
    (first & 0xff_00) === 0xff_00
  ) {
    return true;
  }
  // RFC 8215 local-use NAT64 (`64:ff9b:1::/48`) is always non-public.
  if (hextets[0] === 0x00_64 && hextets[1] === 0xff_9b && hextets[2] === 0x00_01) {
    return true;
  }
  // 6to4 (`2002::/16`) embeds an IPv4 address in hextets 1 and 2.
  if (hextets[0] === 0x20_02) {
    const hi = hextets[1] ?? 0;
    const lo = hextets[2] ?? 0;
    return isNonPublicIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
  }
  // IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::0:0/96`),
  // SIIT IPv4-translated (`::ffff:0:0:0/96`), or well-known NAT64 (`64:ff9b::/96`).
  const isV4Mapped =
    hextets.slice(0, 5).every((h) => h === 0) && (hextets[5] === 0xff_ff || hextets[5] === 0);
  const isSiitTranslated =
    hextets.slice(0, 4).every((h) => h === 0) && hextets[4] === 0xff_ff && hextets[5] === 0;
  const isNat64 =
    hextets[0] === 0x00_64 && hextets[1] === 0xff_9b && hextets.slice(2, 6).every((h) => h === 0);
  if (isV4Mapped || isSiitTranslated || isNat64) {
    const hi = hextets[6] ?? 0;
    const lo = hextets[7] ?? 0;
    return isNonPublicIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
  }
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || host === 'localhost') {
    return true;
  }
  if (host.startsWith('[') || host.includes(':')) {
    return isNonPublicIpv6(host);
  }
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    return isNonPublicIpv4(ipv4);
  }
  if (!host.includes('.')) {
    return true;
  }
  return PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Validates that `raw` is a safe, public `https://` URL suitable for fetching a
 * `.fstheme.json` theme document (rejects non-HTTPS schemes, embedded credentials,
 * loopback/local/private/link-local/metadata IP addresses, and single-label hosts).
 */
export function validateThemeImportUrl(raw: string): ThemeUrlValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter an https:// URL pointing to a .fstheme.json file.' };
  }
  if (trimmed.length > MAX_THEME_IMPORT_URL_LENGTH) {
    return {
      ok: false,
      error: `Theme URL exceeds the ${MAX_THEME_IMPORT_URL_LENGTH}-character limit.`,
    };
  }
  if (hasControlOrSpace(trimmed)) {
    return { ok: false, error: 'Theme URL must not contain spaces or control characters.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a valid https:// URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Theme URLs must use https://.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Theme URLs must not include embedded credentials.' };
  }
  if (isBlockedHost(parsed.hostname)) {
    return {
      ok: false,
      error: 'Local, private, and loopback addresses are not allowed for URL imports.',
    };
  }
  parsed.hash = '';
  return { ok: true, url: parsed.toString(), displayHost: parsed.hostname.toLowerCase() };
}

function cancelBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

async function readCappedUtf8Body(
  response: Response,
  maxBytes: number,
): Promise<
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string }
> {
  const tooLarge = {
    ok: false as const,
    error: `Remote file exceeds the ${maxBytes / 1024} KB limit.`,
  };
  const contentLength = response.headers?.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      cancelBody(response);
      return tooLarge;
    }
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            void reader.cancel().catch(() => undefined);
            return tooLarge;
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    let bytes: Uint8Array;
    if (chunks.length === 1 && chunks[0]) {
      bytes = chunks[0];
    } else {
      bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    try {
      return { ok: true, text: UTF8_DECODER.decode(bytes) };
    } catch {
      return { ok: false, error: 'Remote file is not valid UTF-8 text.' };
    }
  }

  const text = await response.text();
  if (TEXT_ENCODER.encode(text).byteLength > maxBytes) {
    return tooLarge;
  }
  return { ok: true, text };
}

export interface FetchThemeUrlOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Fetches a `.fstheme.json` document from a validated public HTTPS URL with
 * `credentials: 'omit'`, redirect target re-validation, content-type checks,
 * strict UTF-8 decoding, timeout, and a streaming 64 KB size cap.
 */
export async function fetchThemeTextFromUrl(
  rawUrl: string,
  options: FetchThemeUrlOptions = {},
): Promise<ThemeUrlFetchResult> {
  const checked = validateThemeImportUrl(rawUrl);
  if (!checked.ok) {
    return checked;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'Network fetch is unavailable in this environment.' };
  }

  const timeoutMs = options.timeoutMs ?? THEME_URL_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      globalThis.clearTimeout(timer);
      return { ok: false, error: 'Theme fetch was cancelled.' };
    }
    options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetchImpl(checked.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      headers: { Accept: 'application/json, text/plain;q=0.9' },
      signal: controller.signal,
    });

    let finalUrl = checked.url;
    if (response.url && response.url !== checked.url) {
      const finalCheck = validateThemeImportUrl(response.url);
      if (!finalCheck.ok) {
        cancelBody(response);
        return { ok: false, error: 'Theme URL redirected to a blocked address.' };
      }
      finalUrl = finalCheck.url;
    }

    if (!response.ok) {
      cancelBody(response);
      return { ok: false, error: `Server returned HTTP ${response.status}.` };
    }

    const contentType = response.headers?.get('content-type')?.trim() ?? '';
    if (contentType) {
      if (HTML_CONTENT_TYPE_RE.test(contentType)) {
        cancelBody(response);
        return {
          ok: false,
          error:
            'URL returned an HTML page instead of JSON. Link directly to the raw .fstheme.json file.',
        };
      }
      if (!ALLOWED_CONTENT_TYPE_RE.test(contentType)) {
        cancelBody(response);
        return {
          ok: false,
          error: `Unsupported content type "${contentType.split(';')[0]?.trim() ?? contentType}". Expected JSON.`,
        };
      }
    }

    const body = await readCappedUtf8Body(response, MAX_THEME_FILE_BYTES);
    if (!body.ok) {
      return body;
    }
    if (!/\S/.test(body.text)) {
      return { ok: false, error: 'Remote theme file is empty.' };
    }
    return { ok: true, text: body.text, finalUrl };
  } catch (error: unknown) {
    if (timedOut) {
      return { ok: false, error: 'Timed out while fetching theme URL.' };
    }
    if (options.signal?.aborted) {
      return { ok: false, error: 'Theme fetch was cancelled.' };
    }
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    return {
      ok: false,
      error: `Could not fetch theme URL. Check the link and CORS headers${detail}.`,
    };
  } finally {
    globalThis.clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}
