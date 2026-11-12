import { defineContentScript } from 'wxt/utils/define-content-script';
import { startFeatures } from '../core/app';
import { Options } from '../core/options';
import { currentUserId } from '../facebook/user';
import { features } from '../features';

export default defineContentScript({
  matches: ['https://*.facebook.com/*'],
  excludeMatches: [
    'https://*.channel.facebook.com/*',
    'https://*.facebook.com/ai.php*',
    'https://*.facebook.com/connect/*',
    'https://*.facebook.com/saved/*',
  ],
  excludeGlobs: ['https://static.*.facebook.com/*'],
  runAt: 'document_start',
  async main() {
    await startFeatures(features, new Options(`${currentUserId()}/options`));
  },
});
