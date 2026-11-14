// Entry point of the page-world script the userscript adds to the page. The
// userscript build bundles it into a string; see `page-world-plugin.ts`.
// Nothing else imports this file, because importing it starts the
// page-world side.
import { startPageWorld } from './page-world';

startPageWorld();
