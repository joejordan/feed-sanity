import type { Feature } from '../core/feature';
import type { SavedData } from '../core/saved';
import type { FacebookPage } from '../facebook/feature';
import type { OptionsPanel } from '../ui/options-dialog/panel';
import externalCss from './external-css';
import postFilters from './post-filters';
import { filtersPanel } from './post-filters/filters-panel';

/** Every feature the extension runs, in start order. Add new features here. */
export const features: readonly Feature<FacebookPage>[] = [externalCss, postFilters];

/** The parts of the options dialog that features draw themselves. */
export function optionsPanels(data: SavedData): OptionsPanel[] {
  return [filtersPanel(data)];
}
