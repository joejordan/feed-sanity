import type { Logger } from './log';
import { probe } from './dom';
import { Listeners } from './listeners';
import { createLogger } from './log';

/** One way of finding an element. */
export interface Strategy {
  readonly selector: string;
  /** When the selector was last seen working on the live site: a date such as `2026-11-13`, or a year. */
  readonly seen: string;
  readonly note?: string;
}

/**
 * How a locator combines its strategies. With `any`, an element that any
 * strategy matches is found. With `first`, each lookup uses only the first
 * strategy that finds anything, so the strategies are listed most reliable
 * first.
 */
export type LocatorMode = 'any' | 'first';

/** A named, ordered list of strategies for finding one kind of element. */
export interface LocatorSpec {
  readonly name: string;
  readonly mode: LocatorMode;
  readonly strategies: readonly Strategy[];
}

/** A locator that finds what any of its strategies matches. */
export const anyOf = (name: string, strategies: readonly Strategy[]): LocatorSpec => ({
  name,
  mode: 'any',
  strategies,
});

/** A locator that uses the first of its strategies that finds anything. */
export const firstOf = (name: string, strategies: readonly Strategy[]): LocatorSpec => ({
  name,
  mode: 'first',
  strategies,
});

export function isLocatorSpec(value: unknown): value is LocatorSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LocatorSpec).name === 'string' &&
    ((value as LocatorSpec).mode === 'any' || (value as LocatorSpec).mode === 'first') &&
    Array.isArray((value as LocatorSpec).strategies)
  );
}

/** Turns the selectors a site writes into ones the browser can run. */
export interface SelectorResolver {
  /** The selector to run, or null while it cannot be run yet. */
  resolve: (selector: string) => string | null;
  /** Calls `listener` whenever `resolve` may give different answers. Returns a function that stops it. */
  onChange: (listener: () => void) => () => void;
}

/**
 * Finds one kind of element. A strategy that cannot be run yet, or whose
 * selector is not valid, is skipped, so no lookup ever throws.
 *
 * With `first`, every lookup, including `matches` and `closest`, uses the
 * first strategy that finds anything for it.
 */
export interface Locator {
  readonly name: string;
  /** The matching elements inside `root`, in document order. With `keep`, only those it accepts count as found. */
  all: <E extends Element = Element>(root: ParentNode, keep?: (element: E) => boolean) => E[];
  /** The first matching element inside `root`. */
  first: <E extends Element = Element>(root: ParentNode) => E | null;
  /** Like `all`, with `root` itself first if it matches. */
  probe: (root: Element) => Element[];
  matches: (element: Element) => boolean;
  /** `element` or its nearest ancestor that matches. */
  closest: (element: Element) => Element | null;
  /**
   * Every strategy that can run now, joined into one selector, or null when
   * none can. For code that tests many elements in one go, such as a walk
   * over a post's text. What it is used for is not counted.
   */
  selector: () => string | null;
  /**
   * Calls `listener` whenever lookups may find something different: the
   * resolver changed or the user's selectors did. It is shared by every
   * locator of the same `Locators`. Returns a function that stops it.
   */
  onChange: (listener: () => void) => () => void;
}

/** Gives the locator for a spec. */
export type Locate = (spec: LocatorSpec) => Locator;

/** Selectors that replace a locator's own strategies, by locator name. */
export type LocatorOverrides = Readonly<Record<string, readonly string[]>>;

/**
 * Makes locator overrides out of whatever was saved. Keeps each name whose
 * value is a list holding at least one selector, and the selectors in it
 * that are text. An empty list is dropped, so it cannot switch a locator off.
 */
export function readLocatorOverrides(stored: unknown): LocatorOverrides {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {};
  }
  const overrides: [string, string[]][] = [];
  for (const [name, value] of Object.entries(stored)) {
    const selectors = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : [];
    if (selectors.length > 0) {
      overrides.push([name, selectors]);
    }
  }
  return Object.fromEntries(overrides);
}

/** `ready` can be run, `waiting` cannot be run yet, and `invalid` is not a valid selector. */
export type StrategyState = 'invalid' | 'ready' | 'waiting';

export interface StrategyStats {
  /** As written, before the resolver. */
  readonly selector: string;
  /** Null for a selector the user gave. */
  readonly seen: string | null;
  readonly note?: string;
  readonly state: StrategyState;
  /** Lookups it took part in. */
  readonly lookups: number;
  /** Lookups in which it was the first strategy to match one of the elements found. */
  readonly found: number;
  /** When it last found something, in milliseconds since 1970. */
  readonly lastFound: number | null;
  /** How many times its selector turned out not to be valid. */
  readonly errors: number;
}

export interface LocatorStats {
  readonly name: string;
  readonly mode: LocatorMode;
  /** True while the user's selectors stand in for the built-in ones. */
  readonly overridden: boolean;
  readonly lookups: number;
  /** Lookups that found something. */
  readonly found: number;
  readonly strategies: readonly StrategyStats[];
}

/** A strategy as it is used, with its counts. */
class Tried {
  readonly selector: string;
  readonly seen: string | null;
  readonly note: string | undefined;
  state: StrategyState = 'waiting';
  /** The selector from the resolver, while `state` is `ready`. */
  resolved = '';
  lookups = 0;
  found = 0;
  lastFound: number | null = null;
  errors = 0;

  constructor(selector: string, seen: string | null, note?: string) {
    this.selector = selector;
    this.seen = seen;
    this.note = note;
  }

  credit(now: number): void {
    this.found++;
    this.lastFound = now;
  }

  reset(): void {
    this.lookups = 0;
    this.found = 0;
    this.lastFound = null;
    this.errors = 0;
  }

  stats(): StrategyStats {
    return {
      selector: this.selector,
      seen: this.seen,
      ...(this.note === undefined ? {} : { note: this.note }),
      state: this.state,
      lookups: this.lookups,
      found: this.found,
      lastFound: this.lastFound,
      errors: this.errors,
    };
  }
}

/** What a locator runs until the resolver or its strategies change. */
interface Prepared {
  usable: Tried[];
  /** The usable selectors joined, or null when there are none. */
  joined: string | null;
}

/** What a locator needs from the `Locators` it belongs to. */
interface Owner {
  resolve: (selector: string) => string | null;
  /** Logs that a selector is not valid, once per locator and selector. */
  reportInvalid: (name: string, selector: string) => void;
  onChange: (listener: () => void) => () => void;
}

function isValid(selector: string): boolean {
  try {
    // A new fragment each time: happy-dom remembers a query on a node and
    // does not throw for the same selector again.
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `selector` is valid and closed, so a locator can run it.
 *
 * Browsers close what a selector leaves open at its end: a string, a
 * bracket, a parenthesis, a comment or a trailing backslash. Joined with
 * another, such a selector swallows the one after it and the list stays
 * valid, so it is tested alone first. A closed selector is never made
 * valid by one more closing character.
 */
export function isUsableSelector(selector: string): boolean {
  return isValid(selector) && [')', ']', '"', "'"].every((end) => !isValid(selector + end));
}

class RegisteredLocator implements Locator {
  readonly spec: LocatorSpec;
  readonly #owner: Owner;
  readonly #builtIn: Tried[];
  #strategies: Tried[];
  /** The selectors that replace the built-in strategies, or undefined while there are none. */
  #override: readonly string[] | undefined;
  #prepared: Prepared | undefined;
  #lookups = 0;
  #found = 0;

  constructor(spec: LocatorSpec, owner: Owner) {
    this.spec = spec;
    this.#owner = owner;
    this.#builtIn = spec.strategies.map(
      ({ selector, seen, note }) => new Tried(selector, seen, note),
    );
    this.#strategies = this.#builtIn;
  }

  get name(): string {
    return this.spec.name;
  }

  all<E extends Element = Element>(root: ParentNode, keep?: (element: E) => boolean): E[] {
    return this.#lookup((selector) => {
      const found = [...root.querySelectorAll<E>(selector)];
      return keep ? found.filter(keep) : found;
    });
  }

  first<E extends Element = Element>(root: ParentNode): E | null {
    return (
      this.#lookup((selector) => {
        const found = root.querySelector<E>(selector);
        return found ? [found] : [];
      })[0] ?? null
    );
  }

  probe(root: Element): Element[] {
    return this.#lookup((selector) => probe(root, selector));
  }

  matches(element: Element): boolean {
    return this.#lookup((selector) => (element.matches(selector) ? [element] : [])).length > 0;
  }

  closest(element: Element): Element | null {
    return (
      this.#lookup((selector) => {
        const found = element.closest(selector);
        return found ? [found] : [];
      })[0] ?? null
    );
  }

  selector(): string | null {
    return this.#prepare().joined;
  }

  onChange(listener: () => void): () => void {
    return this.#owner.onChange(listener);
  }

  /**
   * Uses `selectors` in place of the built-in strategies, or the built-in
   * ones again for undefined. Returns false when that is what it already used.
   */
  override(selectors: readonly string[] | undefined): boolean {
    const same =
      selectors === this.#override ||
      (selectors !== undefined &&
        this.#override !== undefined &&
        selectors.length === this.#override.length &&
        selectors.every((selector, index) => selector === this.#override?.[index]));
    if (same) {
      return false;
    }
    this.#override = selectors;
    this.#strategies = selectors
      ? selectors.map((selector) => new Tried(selector, null))
      : this.#builtIn;
    this.#prepared = undefined;
    return true;
  }

  /** Forgets the resolved selectors, so the next lookup asks the resolver again. */
  forget(): void {
    this.#prepared = undefined;
  }

  stats(): LocatorStats {
    this.#prepare();
    return {
      name: this.spec.name,
      mode: this.spec.mode,
      overridden: this.#override !== undefined,
      lookups: this.#lookups,
      found: this.#found,
      strategies: this.#strategies.map((strategy) => strategy.stats()),
    };
  }

  resetStats(): void {
    this.#lookups = 0;
    this.#found = 0;
    for (const strategy of new Set([...this.#builtIn, ...this.#strategies])) {
      strategy.reset();
    }
  }

  /** Runs `query` with the strategies this lookup uses and counts what they found. */
  #lookup<E extends Element>(query: (selector: string) => E[]): E[] {
    const { usable, joined } = this.#prepare();
    this.#lookups++;
    let found: E[] = [];
    if (this.spec.mode === 'first') {
      for (const strategy of usable) {
        strategy.lookups++;
        found = query(strategy.resolved);
        if (found.length > 0) {
          strategy.credit(Date.now());
          break;
        }
      }
    } else if (joined !== null) {
      for (const strategy of usable) {
        strategy.lookups++;
      }
      found = query(joined);
      this.#creditUnion(usable, found);
    }
    if (found.length > 0) {
      this.#found++;
    }
    return found;
  }

  /** Credits each strategy that was the first to match one of `found`. Only found elements are tested. */
  #creditUnion(usable: Tried[], found: Element[]): void {
    if (found.length === 0) {
      return;
    }
    const now = Date.now();
    if (usable.length === 1) {
      usable[0]?.credit(now);
      return;
    }
    const credited = new Set<Tried>();
    for (const element of found) {
      const strategy = usable.find((candidate) => element.matches(candidate.resolved));
      if (strategy) {
        credited.add(strategy);
      }
      if (credited.size === usable.length) {
        break;
      }
    }
    for (const strategy of credited) {
      strategy.credit(now);
    }
  }

  #prepare(): Prepared {
    if (this.#prepared) {
      return this.#prepared;
    }
    const usable: Tried[] = [];
    for (const strategy of this.#strategies) {
      const resolved = this.#owner.resolve(strategy.selector);
      if (resolved === null) {
        strategy.state = 'waiting';
      } else if (isUsableSelector(resolved)) {
        strategy.state = 'ready';
        strategy.resolved = resolved;
        usable.push(strategy);
      } else {
        strategy.state = 'invalid';
        strategy.errors++;
        this.#owner.reportInvalid(this.spec.name, resolved);
      }
    }
    // Every usable selector is closed, so joining them cannot change what any of them selects.
    const joined = usable.map((strategy) => strategy.resolved).join(',') || null;
    this.#prepared = { usable, joined };
    return this.#prepared;
  }
}

/**
 * The locators of one page, with their counts and the user's replacement
 * selectors. Resolved selectors are kept until the resolver reports a
 * change or the overrides change.
 *
 * Counting is cheap: a lookup adds to a few numbers, and for an `any`
 * locator only the elements found are tested to see which strategy matched.
 */
export class Locators {
  readonly #log: Logger;
  readonly #locators = new Map<LocatorSpec, RegisteredLocator>();
  readonly #names = new Map<string, RegisteredLocator>();
  readonly #listeners: Listeners;
  #overrides = new Map<string, readonly string[]>();
  /** The invalid selectors already logged, so each is logged once. */
  readonly #reported = new Set<string>();
  readonly #owner: Owner;

  /** `specs` are known from the start, so overrides and `stats` cover them before their first lookup. */
  constructor(
    resolver: SelectorResolver,
    specs: Iterable<LocatorSpec> = [],
    log: Logger = createLogger('locators'),
  ) {
    this.#log = log;
    this.#listeners = new Listeners(log);
    this.#owner = {
      resolve: (selector) => resolver.resolve(selector),
      reportInvalid: (name, selector) => this.#reportInvalid(name, selector),
      onChange: (listener) => this.#listeners.add(listener),
    };
    for (const spec of specs) {
      this.locate(spec);
    }
    resolver.onChange(() => this.#changed());
  }

  /** The locator for `spec`, the same object each time. Can be passed around on its own. */
  readonly locate: Locate = (spec) => {
    let locator = this.#locators.get(spec);
    if (!locator) {
      if (this.#names.has(spec.name)) {
        this.#log.error(`two locators are called '${spec.name}'`);
      }
      locator = new RegisteredLocator(spec, this.#owner);
      locator.override(this.#overrides.get(spec.name));
      this.#locators.set(spec, locator);
      this.#names.set(spec.name, locator);
    }
    return locator;
  };

  /**
   * Replaces the strategies of each named locator with the given selectors,
   * and gives every other locator its own strategies back. A name no locator
   * has changes nothing. Tells the listeners when a locator changed.
   */
  override(overrides: LocatorOverrides): void {
    // Kept whole, so a locator first used later still gets its selectors.
    this.#overrides = new Map(Object.entries(overrides));
    for (const name of this.#overrides.keys()) {
      if (!this.#names.has(name)) {
        this.#log.debug(`no locator is called '${name}'`);
      }
    }
    let changed = false;
    for (const [name, locator] of this.#names) {
      changed = locator.override(this.#overrides.get(name)) || changed;
    }
    if (changed) {
      this.#changed();
    }
  }

  /** Calls `listener` whenever lookups may find something different. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    return this.#listeners.add(listener);
  }

  /** The counts of every locator, in the order they became known. */
  stats(): LocatorStats[] {
    return [...this.#locators.values()].map((locator) => locator.stats());
  }

  /** The name of every locator, in the order they became known. */
  names(): string[] {
    return [...this.#names.keys()];
  }

  /** Sets every count back to zero. */
  resetStats(): void {
    for (const locator of this.#locators.values()) {
      locator.resetStats();
    }
  }

  #changed(): void {
    for (const locator of this.#locators.values()) {
      locator.forget();
    }
    this.#listeners.emit();
  }

  #reportInvalid(name: string, selector: string): void {
    const key = `${name} ${selector}`;
    if (!this.#reported.has(key)) {
      this.#reported.add(key);
      this.#log.error(`'${name}' has a selector that is not valid, and it is skipped: ${selector}`);
    }
  }
}
