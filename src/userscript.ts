// Entry point of the userscript build. See vite.userscript.config.ts.
import { createLogger } from './core/log';
import { userscriptStore } from './platform/userscript-store';
import { start } from './start';

// Nothing awaits this call, so a failure to start has to be reported here.
start(userscriptStore).catch((error: unknown) => {
  createLogger('start').error('failed to start', error);
});
