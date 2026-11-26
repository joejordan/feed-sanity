// Node-safe URL validation helpers shared by site manifests, content scripts,
// and page-world media readers. Keep this file free of DOM or browser APIs.

const MAX_ADDRESS = 4096;

/**
 * True when `address` is a plain `https:` URL on one of `domains` (or any of
 * their subdomains), with no embedded credentials or custom port.
 */
export function isHttpsOnDomains(address: string, domains: readonly string[]): boolean {
  if (address.length > MAX_ADDRESS || !URL.canParse(address)) {
    return false;
  }
  const { protocol, username, password, port, hostname } = new URL(address);
  return (
    protocol === 'https:' &&
    username === '' &&
    password === '' &&
    port === '' &&
    domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  );
}

const MAX_GLOB_CACHE = 64;
const globCache = new Map<string, RegExp>();

/** Turns a wildcard glob (`*` and `?`) into a cached regular expression. */
function compileGlob(glob: string): RegExp {
  let compiled = globCache.get(glob);
  if (!compiled) {
    const escaped = glob.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
    compiled = new RegExp(`^${escaped.replaceAll('*', '.*').replaceAll('?', '.')}$`);
    if (globCache.size < MAX_GLOB_CACHE) {
      globCache.set(glob, compiled);
    }
  }
  return compiled;
}

/** True when `address` matches a content-script glob (`*` and `?` wildcards). */
export function matchesGlobPattern(address: string, glob: string): boolean {
  return compileGlob(glob).test(address);
}

/**
 * True when `address` matches a WebExtension match pattern such as
 * `https://*.facebook.com/ai.php*` or `https://x.com/i/flow/login*`.
 * Used as a runtime guard for Safari `scripting.registerContentScripts`,
 * where `excludeMatches` has historically behaved inconsistently.
 */
export function matchesMatchPattern(address: string, pattern: string): boolean {
  const match = /^(https?|\*):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match || !URL.canParse(address)) {
    return false;
  }
  const [, scheme, hostPattern, pathPattern] = match;
  if (!scheme || !hostPattern || !pathPattern) {
    return false;
  }
  const url = new URL(address);
  if (scheme === '*') {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
  } else if (url.protocol !== `${scheme}:`) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const normalizedHostPattern = hostPattern.toLowerCase();
  if (normalizedHostPattern !== '*') {
    if (normalizedHostPattern.startsWith('*.')) {
      const domain = normalizedHostPattern.slice(2);
      if (host !== domain && !host.endsWith(`.${domain}`)) {
        return false;
      }
    } else if (host !== normalizedHostPattern) {
      return false;
    }
  }
  return matchesGlobPattern(`${url.pathname}${url.search}`, pathPattern);
}

/**
 * True when `address` matches any entry in `excludeMatches` (WebExtension match
 * patterns) or `excludeGlobs` (wildcard globs).
 */
export function isExcludedUrl(
  address: string,
  excludeMatches: readonly string[],
  excludeGlobs: readonly string[] = [],
): boolean {
  return (
    excludeMatches.some((pattern) => matchesMatchPattern(address, pattern)) ||
    excludeGlobs.some((glob) => matchesGlobPattern(address, glob))
  );
}
