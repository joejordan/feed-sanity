// Watches extension sources and automatically rebuilds `.output/safari-mv3`,
// syncs & re-signs `Feed Sanity.app` / `Feed Sanity Extension.appex`, registers
// with macOS `pluginkit`, and optionally runs the native `WKWebExtension` suite.
//
// Usage:
//   node scripts/watch-safari.mjs [--test] [--open]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_TARGETS = ['src', 'public', 'wxt.config.ts', 'project.ts', 'package.json'];
const DEBOUNCE_MS = 250;

const args = new Set(process.argv.slice(2));
const runTests = args.has('--test');
const openOnStart = args.has('--open');

function runNodeScript(scriptRel, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT_DIR, scriptRel), ...scriptArgs], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptRel} exited with code ${code ?? 'signal'}`));
      }
    });
  });
}

let running = false;
let rerunNeeded = false;
let debounceTimer;
let firstRun = true;

async function syncOnce(reason) {
  if (running) {
    rerunNeeded = true;
    return;
  }
  running = true;
  const startedAt = Date.now();
  const isFirst = firstRun;
  firstRun = false;
  console.log(`\n[safari-watch] Updating Safari plugin (${reason})...`);
  try {
    const buildArgs = ['--sync', ...(isFirst && openOnStart ? ['--open'] : [])];
    await runNodeScript('scripts/build-safari-xcode.mjs', buildArgs);
    if (runTests) {
      await runNodeScript('e2e/safari-smoke.mjs', ['--appex']);
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[safari-watch] Safari plugin updated in ${elapsed}s. Refresh open Safari tabs (or toggle Feed Sanity off/on in Safari Settings → Extensions for manifest/background changes).`,
    );
  } catch (error) {
    console.error(
      `[safari-watch] Update failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    running = false;
    if (rerunNeeded) {
      rerunNeeded = false;
      void syncOnce('queued change');
    }
  }
}

function scheduleSync(filePath) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void syncOnce(filePath);
  }, DEBOUNCE_MS);
}

if (process.platform !== 'darwin') {
  console.error('scripts/watch-safari.mjs requires macOS with Xcode installed.');
  process.exit(1);
}

const watchers = [];
for (const rel of WATCH_TARGETS) {
  const full = path.join(ROOT_DIR, rel);
  if (!fs.existsSync(full)) {
    continue;
  }
  const isDir = fs.statSync(full).isDirectory();
  const watcher = fs.watch(full, { recursive: isDir }, (_eventType, filename) => {
    const base = filename ? path.basename(String(filename)) : '';
    if (
      base.startsWith('.') ||
      base.endsWith('~') ||
      base.endsWith('.swp') ||
      base.endsWith('.tmp') ||
      base.endsWith('.test.ts') ||
      base.endsWith('.test.tsx')
    ) {
      return;
    }
    const changed = filename ? path.join(rel, String(filename)) : rel;
    scheduleSync(changed);
  });
  watchers.push(watcher);
}

const shutdown = () => {
  clearTimeout(debounceTimer);
  for (const watcher of watchers) {
    watcher.close();
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(
  `[safari-watch] Watching ${WATCH_TARGETS.join(', ')}${runTests ? ' (with automated WKWebExtension tests)' : ''}. Press Ctrl+C to stop.`,
);
void syncOnce('initial sync');
