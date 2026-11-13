#!/usr/bin/env node
// Switch Claude Code between Anthropic subscription, Anthropic API key, and
// OpenRouter. Cross-platform (Windows/macOS/Linux) — pure Node, no bash or jq.
//
//   subscription - no apiKeyHelper, no overrides; uses the claude.ai OAuth login
//   apikey       - apiKeyHelper reads ANTHROPIC_API_KEY from the env file
//   openrouter   - apiKeyHelper reads OPENROUTER_API_KEY, and ANTHROPIC_BASE_URL
//                  plus the model aliases are pointed at OpenRouter
//
// Usage:
//   node .claude/auth-mode.mjs              # cycle sub -> apikey -> openrouter
//   node .claude/auth-mode.mjs subscription # aliases: sub, oauth, claudeai
//   node .claude/auth-mode.mjs apikey       # aliases: api, key, console
//   node .claude/auth-mode.mjs openrouter   # aliases: or, router
//   node .claude/auth-mode.mjs status       # print current mode, change nothing
//
// Auth is resolved when Claude Code starts, so restart it after switching and
// confirm with /status.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from './env-file.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(here, 'settings.local.json');
// Quoted so a path containing spaces still runs under both cmd and /bin/sh.
const helper = (varName) => `node "${path.join(here, 'provider-api-key.mjs')}" ${varName}`;

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

// Slugs verified against https://openrouter.ai/api/v1/models. Override any of
// them by setting the matching variable in .env-ignore — that is how you point
// Claude Code at a non-Anthropic model (e.g. moonshotai/kimi-k2.5).
const orModel = (alias, fallback) => readEnv(`OPENROUTER_${alias}_MODEL`) || fallback;

// Every settings key this script owns. Anything not listed is left untouched,
// so hand-added env entries survive a switch.
const MANAGED_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
];

const openrouterEnv = () => ({
  ANTHROPIC_BASE_URL: OPENROUTER_BASE_URL,
  // Must be empty: a real Anthropic key exported in the shell would otherwise
  // be sent to OpenRouter as X-Api-Key and take precedence over the helper.
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_DEFAULT_OPUS_MODEL: orModel('OPUS', 'anthropic/claude-opus-5'),
  ANTHROPIC_DEFAULT_SONNET_MODEL: orModel('SONNET', 'anthropic/claude-sonnet-5'),
  ANTHROPIC_DEFAULT_HAIKU_MODEL: orModel('HAIKU', 'anthropic/claude-haiku-4.5'),
  CLAUDE_CODE_SUBAGENT_MODEL: orModel('SUBAGENT', 'anthropic/claude-sonnet-5'),
});

let raw;
try {
  raw = readFileSync(settingsPath, 'utf8');
} catch {
  process.stderr.write(`auth-mode: ${settingsPath} not found\n`);
  process.exit(1);
}
const settings = JSON.parse(raw);

const current = () => {
  if (settings.env?.ANTHROPIC_BASE_URL?.includes('openrouter')) return 'openrouter';
  return typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper.length > 0
    ? 'apikey'
    : 'subscription';
};

const ORDER = ['subscription', 'apikey', 'openrouter'];
const ALIASES = {
  subscription: 'subscription', sub: 'subscription', oauth: 'subscription', claudeai: 'subscription',
  apikey: 'apikey', api: 'apikey', key: 'apikey', console: 'apikey',
  openrouter: 'openrouter', or: 'openrouter', router: 'openrouter',
};

const arg = (process.argv[2] || 'toggle').toLowerCase();
if (arg === 'status') {
  process.stdout.write(`${current()}\n`);
  process.exit(0);
}

let want;
if (arg === 'toggle' || arg === '') want = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
else want = ALIASES[arg];

if (!want) {
  process.stderr.write('usage: auth-mode.mjs [subscription|apikey|openrouter|status]\n');
  process.exit(2);
}

// Start from a clean slate: drop everything this script owns, then re-apply.
for (const key of MANAGED_ENV) delete settings.env?.[key];
if (settings.env && Object.keys(settings.env).length === 0) delete settings.env;
// The user-level `model` is an Anthropic id that OpenRouter cannot resolve, so
// openrouter mode pins its own. Only clear a pin we recognise as ours.
if (typeof settings.model === 'string' && settings.model.includes('/')) delete settings.model;
delete settings.apiKeyHelper;

if (want === 'apikey') {
  settings.apiKeyHelper = helper('ANTHROPIC_API_KEY');
} else if (want === 'openrouter') {
  if (!readEnv('OPENROUTER_API_KEY')) {
    process.stderr.write('auth-mode: OPENROUTER_API_KEY not found in .env-ignore or .env\n');
    process.exit(1);
  }
  settings.apiKeyHelper = helper('OPENROUTER_API_KEY');
  settings.env = { ...settings.env, ...openrouterEnv() };
  settings.model = settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
}

writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}${raw.endsWith('\n') ? '\n' : ''}`);

process.stdout.write(`auth mode -> ${want}\n`);
if (want === 'openrouter') process.stdout.write(`model -> ${settings.model}\n`);
process.stdout.write("restart Claude Code to apply (exit, then 'claude'); verify with /status\n");
