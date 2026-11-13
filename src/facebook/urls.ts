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
