import { defineContentScript } from 'wxt/utils/define-content-script';
import { startXPageWorld } from '../sites/x/page-world';
import { X_EXCLUDE_MATCHES, X_MATCHES } from '../sites/x/urls';

export default defineContentScript({
  matches: [...X_MATCHES],
  excludeMatches: [...X_EXCLUDE_MATCHES],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startXPageWorld();
  },
});
