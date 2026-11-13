import type { AtomRule } from './atom-rules';
import { Listeners } from '../core/listeners';
import { createLogger } from '../core/log';
import { onUrlChange } from '../core/navigation';
import { sleep } from '../core/timing';
import { ATOM_RULES } from './atom-rules';

const log = createLogger('atoms');

/**
 * What one of Facebook's generated class names looks like. Last checked
 * against Facebook in 2023 (Social Fixer 31.1.0).
 */
const ATOM = '[a-z0-9]{6,8}';

/** An `S2F_` name in a selector or in CSS. */
export const TOKEN = /S2F_([a-z0-9_]+)/g;

/** How long to wait before the first rescan. Each later wait is twice as long. */
const FIRST_RETRY_MS = 500;
const LAST_RETRY_MS = 10_000;

interface Matcher {
  name: string;
  selector: RegExp;
  media: string;
}

/** A name and a class whose rule fits it. */
type Found = [name: string, atom: string];

const squash = (text: string): string => text.replaceAll(/\s+/g, '');

/** How many elements on the page carry the class. */
const useCount = (atom: string): number => document.querySelectorAll(`[class~="${atom}"]`).length;

/** Groups a matcher for each rule under its declaration, so a stylesheet rule needs one lookup. */
function buildMatchers(): Map<string, Matcher[]> {
  const byDeclaration = new Map<string, Matcher[]>();
  for (const [name, entry] of Object.entries(ATOM_RULES)) {
    const rule: AtomRule = typeof entry === 'string' ? { css: entry } : entry;
    const prefix = rule.prefix?.replaceAll('ATOM', ATOM) ?? '';
    const atom = rule.media ? String.raw`\.(${ATOM})\.\1` : String.raw`\.(${ATOM})`;
    const matcher: Matcher = {
      name,
      selector: new RegExp(`^${prefix}${atom}${rule.pseudo ?? ''}$`),
      media: squash(rule.media ?? ''),
    };
    const declaration = squash(rule.css);
    byDeclaration.set(declaration, [...(byDeclaration.get(declaration) ?? []), matcher]);
  }
  return byDeclaration;
}

function readableRules(sheet: CSSStyleSheet): CSSRuleList | undefined {
  try {
    return sheet.cssRules;
  } catch {
    // The stylesheet comes from another origin, so the page may not read its rules.
    return undefined;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Translates `S2F_` names in selectors and CSS into the class names Facebook
 * is using on the current page.
 *
 * `scan` reads every stylesheet for rules that consist of one of the
 * declarations in `ATOM_RULES` and remembers the class each one belongs to.
 * Stylesheets the page may not read are downloaded and parsed separately.
 */
export class Atoms {
  readonly #classes = new Map<string, string>();
  /** The highest use count seen for a name's class, so two tied classes do not swap on every scan. */
  readonly #uses = new Map<string, number>();
  readonly #matchers = buildMatchers();
  /**
   * What each downloaded stylesheet held, by address. A download never
   * changes, so only its finds are kept and the parsed stylesheet is let go.
   */
  readonly #downloaded = new Map<string, Found[]>();
  readonly #listeners = new Listeners(log);
  readonly #loadText: (url: string) => Promise<string>;
  #started: Promise<void> | undefined;

  constructor(loadText: (url: string) => Promise<string> = fetchText) {
    this.#loadText = loadText;
  }

  /**
   * Replaces each `S2F_name` with Facebook's class for it. A name with no
   * class yet is left as it is, so `.S2F_name` matches nothing. Inside
   * `:not()` that means it excludes nothing.
   */
  translate(text: string): string {
    return text.replaceAll(TOKEN, (token, name: string) => {
      return this.#classes.get(name) ?? token;
    });
  }

  /** Calls `listener` whenever a scan finds new or different classes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    return this.#listeners.add(listener);
  }

  /**
   * Starts scanning and resolves once the first scan is done. More scans
   * follow: after growing pauses while too few classes are known, because
   * Facebook adds stylesheets as the page loads, and after each move to
   * another page, which can bring stylesheets of its own. Safe to call more
   * than once.
   */
  start(): Promise<void> {
    this.#started ??= this.#firstScan();
    return this.#started;
  }

  /** Reads every stylesheet in the page and tells the listeners if any class changed. */
  async scan(): Promise<void> {
    await this.#downloadUnreadable();

    const found = [
      ...Array.from(document.styleSheets, (sheet) => this.#find(readableRules(sheet))),
      ...this.#downloaded.values(),
    ].flat();
    let changed = false;
    for (const [name, atom] of found) {
      changed = this.#record(name, atom) || changed;
    }

    log.debug(`${this.#classes.size} of ${Object.keys(ATOM_RULES).length} classes known`);
    if (changed) {
      this.#listeners.emit();
    }
  }

  async #firstScan(): Promise<void> {
    const rescan = (): void => {
      this.scan().catch((error: unknown) => {
        log.error('a scan failed', error);
      });
    };
    await this.scan();
    onUrlChange(rescan);
    this.#rescanUntilSettled().catch((error: unknown) => {
      log.error('a scan failed', error);
    });
  }

  async #rescanUntilSettled(): Promise<void> {
    for (let wait = FIRST_RETRY_MS; wait < LAST_RETRY_MS && !this.#settled(); wait *= 2) {
      await sleep(wait);
      await this.scan();
    }
  }

  /** True once a third of the classes are known and a tenth are in use on the page. */
  #settled(): boolean {
    const total = Object.keys(ATOM_RULES).length;
    if (this.#classes.size < total / 3) {
      return false;
    }
    let inUse = 0;
    for (const atom of this.#classes.values()) {
      if (document.querySelector(`[class~="${atom}"]`) && ++inUse >= total / 10) {
        return true;
      }
    }
    return false;
  }

  async #downloadUnreadable(): Promise<void> {
    const downloads: Promise<void>[] = [];
    for (const sheet of document.styleSheets) {
      // `#download` records the address at once, so a stylesheet listed twice is requested once.
      if (sheet.href && !this.#downloaded.has(sheet.href) && !readableRules(sheet)) {
        downloads.push(this.#download(sheet.href));
      }
    }
    await Promise.all(downloads);
  }

  async #download(url: string): Promise<void> {
    // Recorded first, so a stylesheet that fails is not requested again on every scan.
    this.#downloaded.set(url, []);
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(await this.#loadText(url));
      this.#downloaded.set(url, this.#find(sheet.cssRules));
    } catch (error) {
      log.debug(`could not read ${url}`, error);
    }
  }

  /** The names whose rule is in `rules`, each with the class that rule gives it. */
  #find(rules: CSSRuleList | undefined): Found[] {
    const found: Found[] = [];
    for (const rule of rules ?? []) {
      if ('selectorText' in rule) {
        this.#readStyleRule(rule.cssText, '', found);
      } else if ('media' in rule && 'cssRules' in rule) {
        const media = squash(Array.from(rule.media as MediaList).join(','));
        for (const inner of rule.cssRules as CSSRuleList) {
          this.#readStyleRule(inner.cssText, media, found);
        }
      }
      // Anything else is keyframes, font faces and the like. Serialising them would be wasted work.
    }
    return found;
  }

  #readStyleRule(cssText: string, media: string, found: Found[]): void {
    const open = cssText.indexOf('{');
    if (open === -1 || !cssText.startsWith('.')) {
      return;
    }
    const selector = cssText.slice(0, open).trim();
    const declaration = squash(cssText.slice(open + 1, cssText.lastIndexOf('}'))).replace(
      /;+$/,
      '',
    );

    for (const matcher of this.#matchers.get(declaration) ?? []) {
      const inRightMedia = matcher.media ? media.includes(matcher.media) : media === '';
      const atom = inRightMedia ? matcher.selector.exec(selector)?.[1] : undefined;
      if (atom) {
        found.push([matcher.name, atom]);
      }
    }
  }

  /** Remembers `atom` for `name`. When two classes fit one rule, the one used more on the page wins. */
  #record(name: string, atom: string): boolean {
    const current = this.#classes.get(name);
    if (current === atom) {
      return false;
    }
    if (current !== undefined) {
      const uses = useCount(atom) + 1;
      const currentUses = this.#uses.get(name) ?? useCount(current);
      this.#uses.set(name, Math.max(uses, currentUses));
      if (uses <= currentUses) {
        return false;
      }
    }
    this.#classes.set(name, atom);
    return true;
  }
}

/** The part of `Atoms` that code using translated selectors depends on. */
export type AtomTranslator = Pick<Atoms, 'onChange' | 'start' | 'translate'>;
