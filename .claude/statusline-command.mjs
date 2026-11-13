// Claude Code status line — universal (macOS / Linux / devcontainer / Windows).
//
// Why Node and not a bash script:
//   Claude Code runs the statusLine command through whatever shell the platform
//   provides — sh/bash on macOS/Linux, Git Bash *or* PowerShell on Windows. A
//   bash script (or a `bash … || node …` fallback) cannot run on native Windows
//   without Git Bash, where the shell is PowerShell. `node <file>` is the only
//   invocation that is valid in every one of those shells, so a self-contained
//   Node script is the portable choice for a repo that already requires Node.
//
// Why it's fast enough (the disappearing bug):
//   Claude Code cancels an in-flight statusLine script when a new update arrives
//   (updates debounce at 300ms). The old script took 300–950ms because it spawned
//   `git` on every render, so it kept getting cancelled during active streaming
//   and the custom lines vanished. This version spawns NOTHING (git branch is read
//   straight from .git/HEAD) and completes in ~90–170ms, comfortably inside the
//   debounce window.
//
// Robustness contract: never throw out of the top level, never exit non-zero,
// never print empty stdout — any of those blanks the status line.

import { readFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the current git branch by reading .git/HEAD directly — no `git`
// subprocess (slow, and not guaranteed on PATH). Handles worktrees (.git as a
// gitdir pointer file) and detached HEAD (falls back to a short SHA).
function gitBranch(startDir) {
  try {
    let dir = startDir;
    for (let i = 0; i < 50; i++) {
      const dotgit = path.join(dir, '.git');
      if (existsSync(dotgit)) {
        let gitDir = dotgit;
        if (statSync(dotgit).isFile()) {
          const m = readFileSync(dotgit, 'utf8').match(/gitdir:\s*(.+)/);
          if (!m) return '';
          gitDir = path.resolve(dir, m[1].trim());
        }
        const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        return ref ? ref[1] : head.slice(0, 7);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return '';
}

// Auth mode — mirror Claude Code's own resolution so this never lies. Precedence:
//   forceLoginMethod (~/.claude.json) > apiKeyHelper (settings.local.json) >
//   ANTHROPIC_API_KEY/AUTH_TOKEN in env (unless rejected) > subscription.
function authMode(selfDir) {
  try {
    let settings = {};
    try {
      settings = JSON.parse(readFileSync(path.join(selfDir, 'settings.local.json'), 'utf8'));
    } catch {}
    let cfg = {};
    try {
      cfg = JSON.parse(readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    } catch {}

    const envKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
    const rejected = new Set(cfg.customApiKeyResponses?.rejected ?? []);
    const envKeyRejected = Boolean(envKey) && rejected.has(envKey.slice(-20));

    if (cfg.forceLoginMethod === 'claudeai') return false;
    if (cfg.forceLoginMethod === 'console') return true;
    if (typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper.length > 0) return true;
    return Boolean(envKey) && !envKeyRejected;
  } catch {
    return null; // unknown → omit the auth segment rather than guess
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const data = raw.trim() ? JSON.parse(raw) : {};

    const model = data.model?.display_name ?? 'Claude';
    const curDir = data.workspace?.current_dir ?? data.cwd ?? process.cwd();
    const dir = path.basename(curDir) || curDir;
    const cost = Number(data.cost?.total_cost_usd ?? 0) || 0;
    const pct = Math.max(0, Math.min(100, Math.floor(Number(data.context_window?.used_percentage ?? 0) || 0)));
    const durationMs = Number(data.cost?.total_duration_ms ?? 0) || 0;

    // ANSI colors
    const CYAN = '[36m';
    const GREEN = '[32m';
    const YELLOW = '[33m';
    const RED = '[31m';
    const DIM = '[2m';
    const RESET = '[0m';
    const MAGENTA = '[35m';
    const BLUE = '[34m';

    // Auth segment
    const usingApiKey = authMode(path.dirname(fileURLToPath(import.meta.url)));
    const authStr =
      usingApiKey === null
        ? ''
        : usingApiKey
          ? ` ${DIM}|${RESET} ${MAGENTA}auth:api-key${RESET}`
          : ` ${DIM}|${RESET} ${BLUE}auth:sub${RESET}`;

    // Context bar
    const barColor = pct >= 90 ? RED : pct >= 70 ? YELLOW : GREEN;
    const filled = Math.floor(pct / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    // Duration
    const mins = Math.floor(durationMs / 60_000);
    const secs = Math.floor((durationMs % 60_000) / 1000);

    // Git branch (from .git/HEAD, no subprocess)
    const branch = gitBranch(curDir);
    const branchStr = branch ? ` ${DIM}|${RESET} ${branch}` : '';

    // Line 1: model, directory, git branch, auth
    process.stdout.write(`${CYAN}[${model}]${RESET} ${dir}${branchStr}${authStr}\n`);
    // Line 2: context bar, cost, duration (no trailing newline)
    process.stdout.write(
      `${barColor}${bar}${RESET} ${pct}% ${DIM}|${RESET} ${YELLOW}$${cost.toFixed(2)}${RESET} ${DIM}|${RESET} ${mins}m ${secs}s`,
    );
  } catch {
    // Never blank the status line on error — emit at least the model.
    let model = 'Claude';
    try {
      model = JSON.parse(raw)?.model?.display_name ?? 'Claude';
    } catch {}
    process.stdout.write(`[36m[${model}][0m`);
  }
});
