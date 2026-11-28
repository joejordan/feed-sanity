import type { SavedData } from '../../core/saved';
import type { OptionsPanel } from '../../ui/options-dialog/panel';
import { createFiltersPanel } from '../../ui/filters/filters-panel';
import { FACEBOOK_FILTER_SCHEMA } from './schema';

/** The Filters part of the options dialog on Facebook, editing the saved filter list. */
export function filtersPanel(data: SavedData): OptionsPanel {
  return createFiltersPanel(data, FACEBOOK_FILTER_SCHEMA);
}
