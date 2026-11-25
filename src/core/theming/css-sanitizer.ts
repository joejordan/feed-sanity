// Security-critical CSS Syntax Level 3 sanitizer for untrusted `.fstheme.json`
// `customCss` and `typography.customStack`. Pure string processing, zero DOM.

export const MAX_CUSTOM_CSS_BYTES = 16 * 1024;

const FONT_STACK_SAFE_RE = /^[a-zA-Z0-9 ,"'-]+$/;
const UNSAFE_CSS_AT_RULES = new Set(['import', 'charset', 'namespace']);
const UNSAFE_CSS_FUNCTIONS = new Set([
  'url',
  'image-set',
  '-webkit-image-set',
  'image',
  'src',
  'expression',
]);
const UNSAFE_CSS_PROPERTIES = new Set(['behavior', '-moz-binding']);

export interface SanitizedCssResult {
  readonly css: string;
  readonly strippedCount: number;
  readonly truncated: boolean;
}

/** Trims and clamps an optional string field, returning `undefined` when empty or non-string. */
export function cleanDocumentText(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Sanitizes an optional user font stack to safe, balanced local font-family tokens only. */
export function sanitizeFontStack(raw: unknown): string | undefined {
  const text = cleanDocumentText(raw, 200);
  if (!text || !FONT_STACK_SAFE_RE.test(text)) {
    return undefined;
  }
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      return undefined;
    }
    const first = trimmed[0];
    if (first === '"' || first === "'") {
      if (trimmed.length < 3 || trimmed.at(-1) !== first) {
        return undefined;
      }
      const inner = trimmed.slice(1, -1);
      if (inner.includes('"') || inner.includes("'") || !inner.trim()) {
        return undefined;
      }
    } else if (trimmed.includes('"') || trimmed.includes("'")) {
      return undefined;
    }
  }
  return text;
}

function isCssIdentChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  const code = ch.charCodeAt(0);
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 95 ||
    code >= 128
  );
}

function isHexDigit(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function isCssWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function skipCssComment(input: string, start: number): number {
  const close = input.indexOf('*/', start + 2);
  return close === -1 ? input.length : close + 2;
}

/** Reads a CSS identifier starting at `start`, decoding CSS Syntax Level 3 backslash escapes. */
function readCssIdent(
  input: string,
  start: number,
): { readonly name: string; readonly end: number } {
  let i = start;
  let name = '';
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '\\') {
      const next = input[i + 1];
      if (!next || next === '\n' || next === '\r' || next === '\f') {
        break;
      }
      if (isHexDigit(next)) {
        let hexEnd = i + 1;
        while (hexEnd < input.length && hexEnd < i + 7 && isHexDigit(input[hexEnd])) {
          hexEnd++;
        }
        const cp = Number.parseInt(input.slice(i + 1, hexEnd), 16);
        name += cp > 0 && cp <= 0x10_ff_ff ? String.fromCodePoint(cp) : '\ufffd';
        i = hexEnd;
        if (input[i] === '\r' && input[i + 1] === '\n') {
          i += 2;
        } else if (isCssWhitespace(input[i])) {
          i++;
        }
      } else {
        name += next;
        i += 2;
      }
      continue;
    }
    if (isCssIdentChar(ch)) {
      name += ch;
      i++;
      continue;
    }
    break;
  }
  return { name: name.toLowerCase(), end: i };
}

function skipCssSpaceAndComments(input: string, start: number): number {
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (isCssWhitespace(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      i = skipCssComment(input, i);
      continue;
    }
    break;
  }
  return i;
}

function skipCssString(input: string, start: number): number {
  const quote = input[start];
  let i = start + 1;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '\\') {
      const next = input[i + 1];
      if (!next) {
        return input.length;
      }
      if (isHexDigit(next)) {
        let hexEnd = i + 1;
        while (hexEnd < input.length && hexEnd < i + 7 && isHexDigit(input[hexEnd])) {
          hexEnd++;
        }
        i = hexEnd;
        if (input[i] === '\r' && input[i + 1] === '\n') {
          i += 2;
        } else if (isCssWhitespace(input[i])) {
          i++;
        }
      } else if (next === '\r' && input[i + 2] === '\n') {
        i += 3;
      } else {
        i += 2;
      }
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    if (ch === '\n' || ch === '\r' || ch === '\f') {
      return i;
    }
    i++;
  }
  return input.length;
}

function skipBalancedParens(input: string, openIndex: number): number {
  let i = openIndex + 1;
  let depth = 1;
  while (i < input.length && depth > 0) {
    const ch = input[i];
    if (ch === '/' && input[i + 1] === '*') {
      i = skipCssComment(input, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipCssString(input, i);
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    i++;
  }
  return i;
}

function skipUntilDeclarationEnd(input: string, start: number, consumeSemicolon: boolean): number {
  let i = start;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === '/' && input[i + 1] === '*') {
      i = skipCssComment(input, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipCssString(input, i);
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === ';') {
      return consumeSemicolon ? i + 1 : i;
    }
    if (ch === '}') {
      return i;
    }
    i++;
  }
  return input.length;
}

/**
 * Strips network/exfiltration vectors (`@import`, `@charset`, `@namespace`,
 * `url(...)`, `image-set(...)`, `-webkit-image-set(...)`, `image(...)`, `src(...)`,
 * `expression(...)`, `behavior:`, `-moz-binding:`) with CSS escape decoding and
 * comment/string safety, enforcing the 16 KB ceiling on imported custom CSS.
 */
export function sanitizeCustomCss(raw: string): SanitizedCssResult {
  // CSS Syntax Level 3 §3.3 input stream preprocessing: normalize CRLF/CR/FF -> LF and NUL -> U+FFFD.
  const input = raw
    .replace(/\r\n?|\f/g, '\n')
    .replace(/\0/g, '\ufffd')
    .trim();
  const out: string[] = [];
  let strippedCount = 0;
  let i = 0;

  while (i < input.length) {
    const ch = input.charAt(i);

    // Preserve comments verbatim (never emit `*/` inside a comment).
    if (ch === '/' && input[i + 1] === '*') {
      const end = skipCssComment(input, i);
      out.push(input.slice(i, end));
      i = end;
      continue;
    }

    // Preserve quoted strings verbatim (active URL functions start outside quotes).
    if (ch === '"' || ch === "'") {
      const end = skipCssString(input, i);
      out.push(input.slice(i, end));
      i = end;
      continue;
    }

    // Strip disallowed at-rules (`@import`, `@charset`, `@namespace`), escape-aware.
    if (ch === '@') {
      const ident = readCssIdent(input, i + 1);
      if (UNSAFE_CSS_AT_RULES.has(ident.name)) {
        strippedCount++;
        out.push(' ');
        i = skipUntilDeclarationEnd(input, ident.end, true);
        continue;
      }
      out.push(input.slice(i, ident.end));
      i = ident.end;
      continue;
    }

    // Check identifiers (including backslash-escaped starts) for unsafe functions & properties.
    if (isCssIdentChar(ch) || ch === '\\') {
      const ident = readCssIdent(input, i);
      if (ident.end > i) {
        if (UNSAFE_CSS_FUNCTIONS.has(ident.name)) {
          const afterWs = skipCssSpaceAndComments(input, ident.end);
          if (input[afterWs] === '(') {
            strippedCount++;
            out.push(' ');
            i = skipBalancedParens(input, afterWs);
            continue;
          }
        }
        if (UNSAFE_CSS_PROPERTIES.has(ident.name)) {
          const afterWs = skipCssSpaceAndComments(input, ident.end);
          if (input[afterWs] === ':') {
            strippedCount++;
            out.push(' ');
            i = skipUntilDeclarationEnd(input, afterWs + 1, false);
            continue;
          }
        }
        out.push(input.slice(i, ident.end));
        i = ident.end;
        continue;
      }
    }

    out.push(ch);
    i++;
  }

  let css = out.join('').trim();
  let truncated = false;
  if (css.length > MAX_CUSTOM_CSS_BYTES) {
    css = css.slice(0, MAX_CUSTOM_CSS_BYTES).trim();
    truncated = true;
  }
  return { css, strippedCount, truncated };
}
