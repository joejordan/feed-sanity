import { waitForElement } from '../../core/dom';
import { defineFeature } from '../../facebook/feature';

const LINK_ID = 'feed_sanity_external_css';

/** Loads a stylesheet of the user's choosing into every Facebook page. */
export default defineFeature({
  id: 'external_css',
  options: {
    external_css_url: {
      section: 'Advanced',
      title: 'External CSS url',
      description:
        'URL of external CSS to be included in the page. NOTE: browser may require HTTPS, and that server presents MIME type text/css.',
      default: '',
    },
  },
  async setup({ options }) {
    const head = await waitForElement('head');
    options.watch('external_css_url', (value) => {
      document.querySelector(`#${LINK_ID}`)?.remove();
      // A URL of only spaces would resolve to the current page.
      const url = value.trim();
      if (!url) {
        return;
      }
      const link = document.createElement('link');
      link.id = LINK_ID;
      link.rel = 'stylesheet';
      link.href = url;
      head.append(link);
    });
  },
});
