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
    subtitle: 'Decide what gets dropped from your feed, from ads to custom rules.',
  },
  'Inbox Filtering': {
    group: 'site',
    order: 10,
    icon: 'shield',
    subtitle: 'Keep promo rows and noisy threads out of your inbox.',
  },
  'Filters': {
    group: 'site',
    order: 12,
    icon: 'shield',
    subtitle: 'Build custom rules to hide, highlight, or route posts.',
  },
  'Hide Posts': {
    group: 'site',
    order: 14,
    icon: 'shield',
    subtitle: 'Filter out ads, suggested posts, and muted keywords.',
  },
  'Feed & Reading': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Pick your default Home feed, stop surprise refreshes, and mark posts read.',
  },
  'Timeline & Clutter': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Start on Following and clear out Grok, Premium, and sidebar distractions.',
  },
  'Feed & Clutter': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Open straight to Following and trim unused tabs from the left rail.',
  },
  'Layout & Clutter': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Strip away side rails, app promos, and sidebar widgets.',
  },
  'Workspace': {
    group: 'site',
    order: 20,
    icon: 'sliders',
    subtitle: 'Clear out Gemini, Chat, Meet, and side panels for a calmer inbox.',
  },
  'Home Feed': {
    group: 'site',
    order: 22,
    icon: 'sliders',
    subtitle: 'Choose which feed opens first and how the Home layout behaves.',
  },
  'Feed': {
    group: 'site',
    order: 22,
    icon: 'sliders',
    subtitle: 'Tune feed order and built-in post shields.',
  },
  'Navigation': {
    group: 'site',
    order: 24,
    icon: 'sliders',
    subtitle: 'Trim optional links and sidebar rails from the page.',
  },
  'Mark Read': {
    group: 'site',
    order: 26,
    icon: 'sliders',
    subtitle: 'Hide posts you have already seen so your feed stays fresh.',
  },
  'Media': {
    group: 'site',
    order: 30,
    icon: 'play',
    subtitle: 'Seekable video scrubbers and click-to-pause on feed videos.',
  },
  'Videos': {
    group: 'site',
    order: 32,
    icon: 'play',
    subtitle: 'Better playback controls for every feed video.',
  },
  'Stories': {
    group: 'site',
    order: 34,
    icon: 'play',
    subtitle: 'Keep Stories playing smoothly while you browse.',
  },
  'Appearance': {
    group: 'site',
    order: 15,
    icon: 'palette',
    subtitle: 'Color themes, live scenes, typography, and custom CSS for this site.',
  },
  'Advanced': {
    group: 'site',
    order: 80,
    icon: 'sliders',
    subtitle: 'Power-user toggles and external stylesheets.',
  },
  'Sites': {
    group: 'manage',
    order: 100,
    icon: 'globe',
    subtitle: 'Turn Feed Sanity on or off per site. Changes apply right away.',
  },
  'Backup & Reset': {
    group: 'manage',
    order: 110,
    icon: 'database',
    subtitle: 'Save a backup, restore a file, or reset this site to defaults.',
  },
  'Data': {
    group: 'manage',
    order: 110,
    icon: 'database',
    subtitle: 'Save a backup, restore a file, or reset this site to defaults.',
  },
  'Diagnostics': {
    group: 'manage',
    order: 120,
    icon: 'activity',
    subtitle: 'Check what is running, copy a scrubbed bug report, or patch broken selectors.',
  },
};

const SITE_MEDIA_SUBTITLES: Readonly<Record<string, string>> = {
  facebook: 'Video scrubbers, click-to-pause, one-click saves, and Story playback.',
  x: 'Video scrubbers, click-to-pause, and custom playback speeds.',
  instagram: 'Video scrubbers, click-to-pause, and one-click video saves.',
};

export function getSectionMeta(section: string, siteId?: string): SectionMeta {
  const base = KNOWN_SECTIONS[section] ?? {
    group: 'site',
    order: 50,
    icon: 'sliders',
    subtitle: '',
  };
  if (section === 'Media' && siteId && SITE_MEDIA_SUBTITLES[siteId]) {
    return { ...base, subtitle: SITE_MEDIA_SUBTITLES[siteId] };
  }
  if ((section === 'Data' || section === 'Backup & Reset') && siteId === 'facebook') {
    return {
      ...base,
      subtitle: 'Save a backup, restore one, or reset this site to defaults.',
    };
  }
  return base;
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
