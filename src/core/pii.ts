/**
 * Site-agnostic privacy scrubber applied to error messages and diagnostics
 * before copying a bug report: strips URLs, email addresses, and long numeric
 * identifiers. Individual `SiteAdapter`s layer site-specific scrubbers on top.
 */
export const scrubCommonPii = (message: string): string =>
  message
    .replaceAll(/\b(?:[a-z][a-z0-9+.-]*:)+\/\/\S+/gi, '<address>')
    .replaceAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replaceAll(/\d{6,}/g, '<number>');
