import type { LocatorOverrides } from '../core/locator';
import type { OptionSpec, Options, OptionValue } from '../core/options';
import type { SavedValue } from '../core/saved';
import type { PostReadData } from '../facebook/post-read';
import type { Filter } from '../features/post-filters/types';
import { readLocatorOverrides } from '../core/locator';
import { isRecord } from '../core/storage';
import { readFilters } from '../features/post-filters/types';

/** The saved stores that Backup / Restore and Reset operate on. */
export interface DataStores {
  options: Options;
  filters: SavedValue<Filter[]>;
  locators: SavedValue<LocatorOverrides>;
  read_history?: SavedValue<PostReadData> | undefined;
}

/** Portable JSON snapshot of Feed Sanity's settings. */
export interface SettingsBackup {
  options: Record<string, OptionValue>;
  filters: Filter[];
  locators?: LocatorOverrides;
}

/** A validated import ready to apply, or a human-readable error message. */
export type ParsedBackup =
  | {
      readonly ok: true;
      readonly options: Record<string, OptionValue>;
      readonly skippedOptions: number;
      readonly filters: Filter[] | undefined;
      readonly locators: LocatorOverrides | undefined;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

const isValidChoice = (spec: OptionSpec, value: OptionValue): boolean =>
  !spec.choices || spec.choices.some((choice) => choice.value === value);

/** Serializes all current options, filters, and custom locator overrides as pretty-printed JSON. */
export function exportBackup({ options, filters, locators }: DataStores): string {
  const exportedOptions: Record<string, OptionValue> = {};
  for (const [key] of options.list()) {
    exportedOptions[key] = options.get(key);
  }
  const overrides = locators.get();
  const snapshot: SettingsBackup = {
    options: exportedOptions,
    filters: filters.get(),
    ...(Object.keys(overrides).length > 0 ? { locators: overrides } : {}),
  };
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Parses and validates JSON from a Feed Sanity backup. Unknown or incompatible
 * option keys are skipped safely and counted.
 */
export function parseBackup(text: string, specs: readonly [string, OptionSpec][]): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The pasted text is not valid JSON.' };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: 'Settings data must be a JSON object.' };
  }

  const hasOptions = 'options' in raw;
  const hasFilters = 'filters' in raw;
  const hasLocators = 'locators' in raw;
  if (!hasOptions && !hasFilters && !hasLocators) {
    return {
      ok: false,
      error: 'No options, filters or locator overrides were found in that JSON.',
    };
  }

  const specByKey = new Map(specs);
  const parsedOptions: Record<string, OptionValue> = {};
  let skippedOptions = 0;

  if (hasOptions) {
    if (!isRecord(raw.options)) {
      return { ok: false, error: '"options" must be a JSON object.' };
    }
    for (const [key, value] of Object.entries(raw.options)) {
      const spec = specByKey.get(key);
      if (
        spec &&
        (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') &&
        typeof value === typeof spec.default &&
        (typeof value !== 'number' || Number.isFinite(value)) &&
        isValidChoice(spec, value)
      ) {
        parsedOptions[key] = value;
      } else {
        skippedOptions++;
      }
    }
  }

  let parsedFilters: Filter[] | undefined;
  if (hasFilters) {
    if (!Array.isArray(raw.filters) && !isRecord(raw.filters)) {
      return { ok: false, error: '"filters" must be a JSON list.' };
    }
    parsedFilters = readFilters(raw.filters);
  }

  let parsedLocators: LocatorOverrides | undefined;
  if (hasLocators) {
    if (!isRecord(raw.locators)) {
      return { ok: false, error: '"locators" must be a JSON object.' };
    }
    parsedLocators = readLocatorOverrides(raw.locators);
  }

  return {
    ok: true,
    options: parsedOptions,
    skippedOptions,
    filters: parsedFilters,
    locators: parsedLocators,
  };
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** Applies a parsed backup live without requiring a page reload, and returns a status summary. */
export async function applyBackup(
  parsed: Extract<ParsedBackup, { ok: true }>,
  { options, filters, locators }: DataStores,
): Promise<string> {
  const optionEntries = Object.entries(parsed.options);
  for (const [key, value] of optionEntries) {
    await options.set(key, value);
  }
  if (parsed.filters !== undefined) {
    await filters.set(parsed.filters);
  }
  if (parsed.locators !== undefined) {
    await locators.set(parsed.locators);
  }

  const parts: string[] = [];
  if (optionEntries.length > 0) {
    parts.push(plural(optionEntries.length, 'option', 'options'));
  }
  if (parsed.filters !== undefined) {
    parts.push(plural(parsed.filters.length, 'filter', 'filters'));
  }
  if (parsed.locators !== undefined) {
    parts.push(
      plural(Object.keys(parsed.locators).length, 'locator override', 'locator overrides'),
    );
  }
  const skipped =
    parsed.skippedOptions > 0
      ? ` (${plural(parsed.skippedOptions, 'unrecognised option', 'unrecognised options')} skipped)`
      : '';
  return parts.length > 0
    ? `Imported ${parts.join(', ')}${skipped}.`
    : `Nothing matched to import${skipped}.`;
}

/** Resets every registered option to its default and clears saved filters, locator overrides and read history. */
export async function resetAllData({
  options,
  filters,
  locators,
  read_history,
}: DataStores): Promise<void> {
  for (const [key, spec] of options.list()) {
    await options.set(key, spec.default);
  }
  await filters.set([]);
  await locators.set({});
  if (read_history) {
    await read_history.set({});
  }
}
