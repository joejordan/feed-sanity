// Entry point of the userscript build. See vite.userscript.config.ts.
import { createLogger } from './core/log';
import { userscriptPlatform } from './platform/userscript';
import { start } from './start';

// Nothing awaits this call, so a failure to start has to be reported here.
start(userscriptPlatform).catch((error: unknown) => {
  createLogger('start').error('failed to start', error);
});
