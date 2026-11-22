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
