import type { Filter } from '../core/filter-types';
import type { LocatorOverrides } from '../core/locator';
import type { OptionSpec, Options, OptionValue } from '../core/options';
import type { SavedValue } from '../core/saved';
import type { SiteSettingsClient } from '../core/site-settings';
import type { ThemeDocumentV1, ThemeLibraryClient } from '../core/theming';
import type { ReadHistory } from '../facebook/read-history';
import type { SavedVideoSpeed } from '../sites/x/features/video-speed-model';
import { readFilters } from '../core/filter-types';
import { readLocatorOverrides } from '../core/locator';
import { isRecord } from '../core/storage';
import {
  analyzeThemeDocument,
  DEFAULT_THEME_DOCUMENT,
  isSiteDefaultDocument,
  MAX_LIBRARY_THEMES,
  parseThemeDocument,
} from '../core/theming';
import {
  DEFAULT_VIDEO_SPEED,
  MAX_VIDEO_SPEED,
  MIN_VIDEO_SPEED,
  readSavedVideoSpeed,
} from '../sites/x/features/video-speed-model';

/** The saved stores that Backup / Restore and Reset operate on. */
export interface DataStores {
  readonly siteId?: string | undefined;
  readonly options: Options;
  readonly filters: SavedValue<Filter[]>;
  readonly locators: SavedValue<LocatorOverrides>;
  readonly theme?: SavedValue<ThemeDocumentV1> | undefined;
  readonly themeLibrary?: ThemeLibraryClient | undefined;
  readonly siteSettings?: SiteSettingsClient | undefined;
  readonly readHistory?: SavedValue<ReadHistory> | undefined;
  readonly videoSpeed?: SavedValue<SavedVideoSpeed> | undefined;
}

/** Portable JSON snapshot of Feed Sanity's settings (`options`, `filters` and more). */
export interface SettingsBackup {
  site?: string;
  options: Record<string, OptionValue>;
  filters: Filter[];
  locators?: LocatorOverrides;
  theme?: ThemeDocumentV1;
  myThemes?: ThemeDocumentV1[];
  sites?: Record<string, boolean>;
  videoSpeed?: SavedVideoSpeed;
}

/** A validated import ready to apply, or a human-readable error message. */
export type ParsedBackup =
  | {
      readonly ok: true;
      readonly site: string | undefined;
      readonly options: Record<string, OptionValue>;
      readonly skippedOptions: number;
      readonly filters: Filter[] | undefined;
      readonly locators: LocatorOverrides | undefined;
      readonly theme: ThemeDocumentV1 | undefined;
      readonly myThemes: ThemeDocumentV1[] | undefined;
      readonly sites: Record<string, boolean> | undefined;
      readonly videoSpeed: SavedVideoSpeed | undefined;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

const isValidChoice = (spec: OptionSpec, value: OptionValue): boolean =>
  !spec.choices || spec.choices.some((choice) => choice.value === value);

/** Serializes all current options, filters, theme, custom locator overrides, and optional global data as pretty-printed JSON. */
export function exportBackup({
  siteId,
  options,
  filters,
  locators,
  theme,
  themeLibrary,
  siteSettings,
  videoSpeed,
}: DataStores): string {
  const exportedOptions: Record<string, OptionValue> = {};
  for (const [key] of options.list()) {
    exportedOptions[key] = options.get(key);
  }
  const overrides = locators.get();
  const currentTheme = theme?.get();
  const savedThemes = themeLibrary?.list().map((entry) => entry.document) ?? [];
  const siteToggles = siteSettings
    ? Object.fromEntries(siteSettings.list().map((site) => [site.id, site.enabled]))
    : undefined;
  const currentSpeed = videoSpeed?.get();
  const hasCustomSpeed =
    currentSpeed !== undefined &&
    (currentSpeed.rate !== DEFAULT_VIDEO_SPEED.rate || currentSpeed.custom);
  const snapshot: SettingsBackup = {
    ...(siteId ? { site: siteId } : {}),
    options: exportedOptions,
    filters: filters.get(),
    ...(Object.keys(overrides).length > 0 ? { locators: overrides } : {}),
    ...(currentTheme && !isSiteDefaultDocument(currentTheme) ? { theme: currentTheme } : {}),
    ...(savedThemes.length > 0 ? { myThemes: savedThemes } : {}),
    ...(siteToggles && Object.keys(siteToggles).length > 0 ? { sites: siteToggles } : {}),
    ...(hasCustomSpeed ? { videoSpeed: currentSpeed } : {}),
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
  const hasTheme = 'theme' in raw;
  const hasMyThemes = 'myThemes' in raw;
  const hasSites = 'sites' in raw;
  const hasVideoSpeed = 'videoSpeed' in raw;
  if (
    !hasOptions &&
    !hasFilters &&
    !hasLocators &&
    !hasTheme &&
    !hasMyThemes &&
    !hasSites &&
    !hasVideoSpeed
  ) {
    return {
      ok: false,
      error: 'No options, filters, themes or locator overrides were found in that JSON.',
    };
  }

  const rawSite = typeof raw.site === 'string' ? raw.site.trim().toLowerCase() : '';
  const site = /^[a-z0-9_-]{1,32}$/.test(rawSite) ? rawSite : undefined;
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

  // Only a list replaces the saved filters. Any other value reads as no
  // filters at all, so a damaged section cannot wipe the user's list.
  const parsedFilters = Array.isArray(raw.filters) ? readFilters(raw.filters) : undefined;

  let parsedLocators: LocatorOverrides | undefined;
  if (hasLocators) {
    if (!isRecord(raw.locators)) {
      return { ok: false, error: '"locators" must be a JSON object.' };
    }
    parsedLocators = readLocatorOverrides(raw.locators);
  }

  let parsedTheme: ThemeDocumentV1 | undefined;
  if (hasTheme) {
    if (!isRecord(raw.theme)) {
      return { ok: false, error: '"theme" must be a JSON object.' };
    }
    const parsedThemeDoc = parseThemeDocument(raw.theme);
    if (!parsedThemeDoc.ok || !parsedThemeDoc.document) {
      return {
        ok: false,
        error: parsedThemeDoc.errors[0] ?? '"theme" is not a valid Feed Sanity theme document.',
      };
    }
    parsedTheme = parsedThemeDoc.document;
  }

  let parsedMyThemes: ThemeDocumentV1[] | undefined;
  if (hasMyThemes) {
    if (!Array.isArray(raw.myThemes)) {
      return { ok: false, error: '"myThemes" must be a JSON array.' };
    }
    const validThemes: ThemeDocumentV1[] = [];
    for (const entry of raw.myThemes.slice(0, MAX_LIBRARY_THEMES)) {
      const doc = parseThemeDocument(entry);
      if (doc.ok && doc.document) {
        validThemes.push(doc.document);
      }
    }
    parsedMyThemes = validThemes;
  }

  let parsedSites: Record<string, boolean> | undefined;
  if (hasSites) {
    if (!isRecord(raw.sites)) {
      return { ok: false, error: '"sites" must be a JSON object.' };
    }
    const cleanSites: Record<string, boolean> = {};
    for (const [id, enabled] of Object.entries(raw.sites)) {
      if (typeof enabled === 'boolean') {
        cleanSites[id] = enabled;
      }
    }
    parsedSites = cleanSites;
  }

  let parsedVideoSpeed: SavedVideoSpeed | undefined;
  if (hasVideoSpeed) {
    if (
      !isRecord(raw.videoSpeed) ||
      typeof raw.videoSpeed.rate !== 'number' ||
      !Number.isFinite(raw.videoSpeed.rate) ||
      raw.videoSpeed.rate < MIN_VIDEO_SPEED ||
      raw.videoSpeed.rate > MAX_VIDEO_SPEED
    ) {
      return {
        ok: false,
        error: `"videoSpeed" must include a numeric rate between ${MIN_VIDEO_SPEED} and ${MAX_VIDEO_SPEED}.`,
      };
    }
    parsedVideoSpeed = readSavedVideoSpeed(raw.videoSpeed);
  }

  return {
    ok: true,
    site,
    options: parsedOptions,
    skippedOptions,
    filters: parsedFilters,
    locators: parsedLocators,
    theme: parsedTheme,
    myThemes: parsedMyThemes,
    sites: parsedSites,
    videoSpeed: parsedVideoSpeed,
  };
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** Applies a parsed backup live without requiring a page reload, and returns a status summary. */
export async function applyBackup(
  parsed: Extract<ParsedBackup, { ok: true }>,
  { siteId, options, filters, locators, theme, themeLibrary, siteSettings, videoSpeed }: DataStores,
): Promise<string> {
  const optionEntries = Object.entries(parsed.options);
  let addedThemes = 0;
  let updatedSites = 0;

  const tasks: Promise<unknown>[] = [];
  if (optionEntries.length > 0) {
    tasks.push(
      (async () => {
        for (const [key, value] of optionEntries) {
          await options.set(key, value);
        }
      })(),
    );
  }
  if (parsed.filters !== undefined) {
    tasks.push(filters.set(parsed.filters));
  }
  if (parsed.locators !== undefined) {
    tasks.push(locators.set(parsed.locators));
  }
  if (parsed.theme !== undefined && theme) {
    tasks.push(theme.set(parsed.theme));
  }
  if (parsed.myThemes && parsed.myThemes.length > 0 && themeLibrary) {
    const incomingThemes = parsed.myThemes;
    tasks.push(
      (async () => {
        const existingFingerprints = new Set(
          themeLibrary.list().map((entry) => analyzeThemeDocument(entry.document).fingerprint),
        );
        for (const doc of incomingThemes) {
          if (themeLibrary.list().length >= MAX_LIBRARY_THEMES) {
            break;
          }
          const fp = analyzeThemeDocument(doc).fingerprint;
          if (existingFingerprints.has(fp)) {
            continue;
          }
          await themeLibrary.saveTheme(doc);
          existingFingerprints.add(fp);
          addedThemes++;
        }
      })(),
    );
  }
  if (parsed.sites && siteSettings) {
    const incomingSites = parsed.sites;
    tasks.push(
      (async () => {
        const knownIds = new Set(siteSettings.list().map((s) => s.id));
        for (const [id, enabled] of Object.entries(incomingSites)) {
          if (knownIds.has(id)) {
            await siteSettings.setEnabled(id, enabled);
            updatedSites++;
          }
        }
      })(),
    );
  }
  if (parsed.videoSpeed !== undefined && videoSpeed) {
    tasks.push(videoSpeed.set(parsed.videoSpeed));
  }
  await Promise.all(tasks);

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
  if (parsed.theme !== undefined && theme) {
    parts.push('theme');
  }
  if (addedThemes > 0) {
    parts.push(plural(addedThemes, 'saved theme', 'saved themes'));
  }
  if (updatedSites > 0) {
    parts.push(plural(updatedSites, 'site toggle', 'site toggles'));
  }
  if (parsed.videoSpeed !== undefined && videoSpeed) {
    parts.push('video speed');
  }
  const skipped =
    parsed.skippedOptions > 0
      ? ` (${plural(parsed.skippedOptions, 'unrecognised option', 'unrecognised options')} skipped)`
      : '';
  const mismatch =
    parsed.site && siteId && parsed.site !== siteId
      ? ` Note: this backup was exported from ${parsed.site}.`
      : '';
  const base =
    parts.length > 0
      ? `Imported ${parts.join(', ')}${skipped}.`
      : `Nothing matched to import${skipped}.`;
  return `${base}${mismatch}`;
}

/** Resets every registered option to its default and clears saved filters, theme, locator overrides, read history, and custom video speed. */
export async function resetAllData({
  options,
  filters,
  locators,
  theme,
  readHistory,
  videoSpeed,
}: DataStores): Promise<void> {
  for (const [key, spec] of options.list()) {
    await options.set(key, spec.default);
  }
  await filters.set([]);
  await locators.set({});
  if (theme) {
    await theme.set({ ...DEFAULT_THEME_DOCUMENT });
  }
  if (readHistory) {
    await readHistory.set({});
  }
  if (videoSpeed) {
    await videoSpeed.set({ ...DEFAULT_VIDEO_SPEED });
  }
}
