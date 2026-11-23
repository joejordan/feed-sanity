// Keep this file free of DOM or browser-API imports so Node build configs
// (`vite.userscript.config.ts`, `src/sites/manifest.ts`) and content scripts
// can import Gmail's URL match rules directly.

export const GMAIL_MATCHES: readonly string[] = ['https://mail.google.com/*'];

export const GMAIL_EXCLUDE_MATCHES: readonly string[] = [
  'https://mail.google.com/mail/u/*/data*',
  'https://mail.google.com/sync/*',
];

/** True for Gmail web app hosts (`mail.google.com`). */
export const isGmailHost = (hostname: string): boolean => /^mail\.google\.com$/i.test(hostname);
