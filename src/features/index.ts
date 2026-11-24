import type { Feature } from '../core/feature';
import type { SavedData } from '../core/saved';
import type { FacebookPage } from '../facebook/feature';
import type { OptionsPanel } from '../ui/options-dialog/panel';
import externalCss from './external-css';
import facebookDisplayNotice from './facebook-display-notice';
import homeFeed from './home-feed';
import markRead from './mark-read';
import postFilters from './post-filters';
import { filtersPanel } from './post-filters/filters-panel';
import stopFeedRefresh from './stop-feed-refresh';
import storiesKeepPlaying from './stories-keep-playing';
import videoClickPauses from './video-click-pauses';
import videoDownload from './video-download';
import videoScrubber from './video-scrubber';

/** Every feature the extension runs, in start order. Add new features here. */
export const features: readonly Feature<FacebookPage>[] = [
  homeFeed,
  facebookDisplayNotice,
  stopFeedRefresh,
  postFilters,
  markRead,
  storiesKeepPlaying,
  videoScrubber,
  videoClickPauses,
  videoDownload,
  externalCss,
];

/** The parts of the options dialog that features draw themselves. */
export function optionsPanels(data: SavedData): OptionsPanel[] {
  return [filtersPanel(data)];
}
