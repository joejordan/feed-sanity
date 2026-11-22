import { feedAddress, HOME_ADDRESS } from '../../facebook/home-feed';

/**
 * One entry of the feed menu, and one choice of the `home_feed` option.
 * Add an entry here and it appears in both.
 */
export interface FeedEntry {
  /** Saved as the value of `home_feed`. */
  readonly id: string;
  readonly label: string;
  /** SVG path data on a 24 by 24 grid, drawn as 2 pixel lines. */
  readonly icon: string;
  /** Where the entry leads, on the site. */
  readonly address: string;
  /** Entries are grouped by this, with a line between groups. */
  readonly group: string;
  /**
   * Facebook's numeric `feedStyle` for `CometHomeRootEntryPointVariables`,
   * letting `/` switch feeds in place without changing the URL. Null for
   * Facebook's own default Home feed.
   */
  readonly feedStyle: number | null;
}

/** The entry for Facebook's own feed, which changes nothing. */
export const FACEBOOK_FEED = 'home';

const HOME: FeedEntry = {
  id: FACEBOOK_FEED,
  label: 'Home',
  icon: 'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
  address: HOME_ADDRESS,
  group: 'facebook',
  feedStyle: null,
};

/** Every entry, in the order the menu lists them. */
export const FEEDS: readonly FeedEntry[] = [
  HOME,
  {
    id: 'friends',
    label: 'Friends',
    icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.3a4 4 0 0 1 0 7.4M18.5 14a7 7 0 0 1 3.5 6v1',
    address: feedAddress('friends'),
    group: 'feeds',
    feedStyle: 17,
  },
  {
    id: 'favorites',
    label: 'Favorites',
    icon: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',
    address: feedAddress('favorites'),
    group: 'feeds',
    feedStyle: 12,
  },
  {
    id: 'groups',
    label: 'Groups',
    icon: 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.5 20v-.5a5.5 5.5 0 0 1 11 0v.5M5.5 11.5a2.5 2.5 0 0 1 0-5M18.5 11.5a2.5 2.5 0 0 0 0-5M2 18.5v-.5a4 4 0 0 1 3-3.9M22 18.5v-.5a4 4 0 0 0-3-3.9',
    address: feedAddress('groups'),
    group: 'feeds',
    feedStyle: 18,
  },
  {
    id: 'pages',
    label: 'Pages',
    icon: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5',
    address: feedAddress('pages'),
    group: 'feeds',
    feedStyle: 19,
  },
  {
    id: 'all',
    label: 'Most recent',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
    address: feedAddress('all'),
    group: 'feeds',
    feedStyle: 16,
  },
];

/** The entry saved as `id`, or Facebook's own feed when there is none. */
export const feedById = (id: string): FeedEntry => FEEDS.find((feed) => feed.id === id) ?? HOME;
