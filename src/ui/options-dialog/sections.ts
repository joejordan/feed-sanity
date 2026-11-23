import type { UiIconName } from '../primitives/icons';

export type SectionGroup = 'site' | 'manage';

export interface SectionMeta {
  readonly group: SectionGroup;
  readonly order: number;
  readonly icon: UiIconName;
  readonly subtitle: string;
}

/**
 * Canonical section ordering, sidebar grouping (`THIS SITE` vs `FEED SANITY`),
 * monochrome icons, and section subtitles across all 5 supported sites.
 * Unknown sections (e.g. in unit tests) fall back cleanly under `'site'`.
 */
const KNOWN_SECTIONS: Readonly<Record<string, SectionMeta>> = {
  'Filtering': {
    group: 'site',
    order: 10,
    icon: 'shield',
    subtitle: 'Ad shields, custom filter rules, and keyword blocklists.',
  },
  'Inbox Filtering': {
    group: 'site',
    order: 10,
    icon: 'shield',
    subtitle: 'Inbox ad blocking, thread rules, and muted keywords.',
  },
  'Filters': {
    group: 'site',
    order: 12,
    icon: 'shield',
    subtitle: 'Custom filter rules and post hiding controls.',
  },
  'Hide Posts': {
    group: 'site',
    order: 14,
    icon: 'shield',
    subtitle: 'Hide ads, suggested posts, and keyword matches.',
  },
  'Feed & Reading': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Default feed, scroll stability, and marking posts as read.',
  },
  'Timeline & Clutter': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Default timeline tab and distraction-free page clutter controls.',
  },
  'Feed & Clutter': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Default feed and distraction-free navigation controls.',
  },
  'Layout & Clutter': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Hide sidebars, promo banners, and distracting widgets.',
  },
  'Workspace': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Hide Gemini, sidebars, Chat & Meet, and inbox clutter.',
  },
  'Home Feed': {
    group: 'site',
    order: 22,
    icon: 'sliders',
    subtitle: 'Choose your default feed and layout controls.',
  },
  'Feed': {
    group: 'site',
    order: 22,
    icon: 'sliders',
    subtitle: 'Feed preferences and built-in filters.',
  },
  'Navigation': {
    group: 'site',
    order: 24,
    icon: 'sliders',
    subtitle: 'Hide optional navigation items and sidebar rails.',
  },
  'Mark Read': {
    group: 'site',
    order: 26,
    icon: 'sliders',
    subtitle: 'Mark seen posts as read to keep them out of your way.',
  },
  'Media': {
    group: 'site',
    order: 30,
    icon: 'play',
    subtitle: 'Video playback controls, speed, and story behavior.',
  },
  'Videos': {
    group: 'site',
    order: 32,
    icon: 'play',
    subtitle: 'Scrubber, click-to-pause, download, and playback speed.',
  },
  'Stories': {
    group: 'site',
    order: 34,
    icon: 'play',
    subtitle: 'Control how story playback behaves.',
  },
  'Appearance': {
    group: 'site',
    order: 40,
    icon: 'palette',
    subtitle: 'Theme presets, site-wide typography, custom CSS, and live health checks.',
  },
  'Advanced': {
    group: 'site',
    order: 80,
    icon: 'sliders',
    subtitle: 'Power-user options and external stylesheets.',
  },
  'Sites': {
    group: 'manage',
    order: 100,
    icon: 'globe',
    subtitle: 'Enable or pause Feed Sanity across all supported sites.',
  },
  'Backup & Reset': {
    group: 'manage',
    order: 110,
    icon: 'database',
    subtitle: 'Export, import, and reset settings for this site.',
  },
  'Data': {
    group: 'manage',
    order: 110,
    icon: 'database',
    subtitle: 'Export, import, and reset settings for this site.',
  },
  'Diagnostics': {
    group: 'manage',
    order: 120,
    icon: 'activity',
    subtitle: 'Runtime health, bug reports, and custom DOM locator overrides.',
  },
};

export function getSectionMeta(section: string): SectionMeta {
  return (
    KNOWN_SECTIONS[section] ?? {
      group: 'site',
      order: 50,
      icon: 'sliders',
      subtitle: '',
    }
  );
}

/** Sorts unique section names into intentional mental-model order (`THIS SITE` then `FEED SANITY`). */
export function orderSections(names: readonly string[]): string[] {
  const unique = [...new Set(names)];
  const indexOf = new Map<string, number>();
  for (let i = 0; i < unique.length; i++) {
    const name = unique[i];
    if (name !== undefined) {
      indexOf.set(name, i);
    }
  }
  return unique.sort((a, b) => {
    const ma = getSectionMeta(a);
    const mb = getSectionMeta(b);
    if (ma.order !== mb.order) {
      return ma.order - mb.order;
    }
    return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
  });
}
