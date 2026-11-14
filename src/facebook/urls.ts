// The Facebook pages the code runs on. The extension manifest and the
// userscript header are both written from these lists.

export const MATCHES = ['https://*.facebook.com/*'];

/** Pages under MATCHES to stay out of. */
export const EXCLUDE_MATCHES = [
  'https://*.channel.facebook.com/*',
  'https://*.facebook.com/ai.php*',
  'https://*.facebook.com/connect/*',
  'https://*.facebook.com/saved/*',
];

/** As EXCLUDE_MATCHES, for hosts a match pattern cannot express. */
export const EXCLUDE_GLOBS = ['https://static.*.facebook.com/*'];

/** Facebook's own domains: its site and its file servers. Each one's subdomains count too. */
const OWN_DOMAINS = ['facebook.com', 'fbcdn.net'];

/** The longest address taken from the page. Video addresses were 650 to 700 characters on 2026-11-14. */
const MAX_ADDRESS = 4096;

/**
 * True when `address` is an `https:` address on one of Facebook's own
 * domains, with no user name, password or port. Addresses read from the
 * page are checked with this before anything uses them.
 */
export function isFacebookAddress(address: string): boolean {
  if (address.length > MAX_ADDRESS || !URL.canParse(address)) {
    return false;
  }
  const { protocol, username, password, port, hostname } = new URL(address);
  return (
    protocol === 'https:' &&
    username === '' &&
    password === '' &&
    port === '' &&
    OWN_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
  );
}
