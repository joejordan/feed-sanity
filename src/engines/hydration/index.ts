// Shared SSR hydration JSON extractor (`<script type="application/json">`).
// Many modern SPAs (Facebook/Instagram Relay payloads, Next.js `__NEXT_DATA__`,
// X/YouTube/Reddit SSR data blocks) embed initial structured state in inline
// JSON script tags. This engine parses them safely with zero global state,
// bounded byte/script budgets, and optional fast pre-filters so non-matching
// scripts never pay JSON.parse overhead.

export interface HydrationScanOptions {
  /** Selector for candidate script tags (defaults to `'script[type="application/json"]'`). */
  readonly selector?: string;
  /** Optional regex filtering `script.id` before reading script text. */
  readonly idPattern?: RegExp;
  /** Optional fast substring/regex check on raw script text before `JSON.parse`. */
  readonly textHint?: string | RegExp;
  /** Maximum characters per script to parse (defaults to 2_000_000). */
  readonly maxCharsPerScript?: number;
  /** Maximum number of script elements to inspect (defaults to 200). */
  readonly maxScripts?: number;
}

export interface HydrationPayload {
  readonly script: HTMLScriptElement;
  readonly id: string;
  readonly data: unknown;
}

const DEFAULT_SELECTOR = 'script[type="application/json"]';
const DEFAULT_MAX_CHARS = 2_000_000;
const DEFAULT_MAX_SCRIPTS = 200;

function matchesHint(text: string, hint: string | RegExp | undefined): boolean {
  if (hint === undefined) {
    return true;
  }
  return typeof hint === 'string' ? text.includes(hint) : hint.test(text);
}

function* iterateHydrationScripts(
  root: ParentNode,
  {
    selector = DEFAULT_SELECTOR,
    idPattern,
    textHint,
    maxCharsPerScript = DEFAULT_MAX_CHARS,
    maxScripts = DEFAULT_MAX_SCRIPTS,
  }: HydrationScanOptions = {},
): Generator<HydrationPayload> {
  const scripts = root.querySelectorAll<HTMLScriptElement>(selector);
  let inspected = 0;

  for (const script of scripts) {
    if (inspected >= maxScripts) {
      break;
    }
    inspected++;
    const id = script.id || '';
    if (idPattern && !idPattern.test(id)) {
      continue;
    }
    const raw = script.textContent;
    if (!raw || raw.length > maxCharsPerScript) {
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || !matchesHint(trimmed, textHint)) {
      continue;
    }
    try {
      const cleaned = trimmed.startsWith('for (;;);') ? trimmed.slice(9) : trimmed;
      yield { script, id, data: JSON.parse(cleaned) };
    } catch {
      // Ignore malformed or non-JSON script blocks.
    }
  }
}

/**
 * Extracts and parses inline JSON hydration payloads from `root` (a `Document`,
 * `ShadowRoot`, or `Element`), skipping malformed, oversized, or non-matching
 * scripts safely.
 */
export function scanHydrationScripts(
  root: ParentNode = document,
  options?: HydrationScanOptions,
): HydrationPayload[] {
  return [...iterateHydrationScripts(root, options)];
}

/**
 * Convenience helper returning the first non-undefined value extracted by
 * `extract` across matching hydration scripts in `root`, stopping as soon as
 * a match is found without parsing later scripts.
 */
export function findInHydration<T>(
  root: ParentNode,
  extract: (payload: HydrationPayload) => T | undefined,
  options?: HydrationScanOptions,
): T | undefined {
  for (const payload of iterateHydrationScripts(root, options)) {
    const found = extract(payload);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
