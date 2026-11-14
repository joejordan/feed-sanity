import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Tabs } from './tabs';
import { mount } from '../../ui/mount';
import css from './tab-panel.css?inline';

const HOST_ID = 'feed_sanity_filter_tabs';

interface TabPanelProps {
  tabs: Tabs;
  /** Reports whether the list should show before any filter has made a tab. */
  watchAlwaysShow: (listener: (value: boolean) => void) => () => void;
}

/**
 * The list of filter tabs, in a corner of the page. Clicking a tab shows its
 * posts and hides the rest. It stays out of the way until a filter has moved
 * a post to a tab of its own.
 */
function TabPanel({ tabs, watchAlwaysShow }: TabPanelProps) {
  const [alwaysShow, setAlwaysShow] = useState(false);
  // Renders again when the tabs change, including a change made before
  // this component had subscribed.
  const subscribe = useCallback((onChange: () => void) => tabs.onChange(onChange), [tabs]);
  useSyncExternalStore(subscribe, () => tabs.version);

  useEffect(() => watchAlwaysShow(setAlwaysShow), [watchAlwaysShow]);

  if (!alwaysShow && !tabs.hasCustomTabs) {
    return null;
  }
  return (
    <nav className="panel" aria-label="Filter tabs">
      <h2 className="heading">Filter tabs</h2>
      <ul className="tabs">
        {tabs.list().map(({ name, total, hidden, selected }) => (
          <li key={name}>
            <button
              className="tab"
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => tabs.select(name)}
            >
              <span className="name">{name}</span>
              <span className="count" title={`${total} posts, ${hidden} of them hidden`}>
                {hidden > 0 ? `${total - hidden}/${total}` : total}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Adds the tab list to the page. Returns a function that removes it. */
export function showTabPanel(props: TabPanelProps): () => void {
  return mount(<TabPanel {...props} />, { id: HOST_ID, css });
}
