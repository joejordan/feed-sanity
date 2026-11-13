#!/usr/bin/env node
// apiKeyHelper for Claude Code — prints one provider key from the repo-root
// env file. Claude Code sends the value as both `X-Api-Key` and
// `Authorization: Bearer`, so the same helper serves Anthropic and OpenRouter.
//
// Cross-platform: Claude Code runs this through the system shell (/bin/sh on
// macOS/Linux, cmd on Windows), so it is registered as `node <this file>` and
// needs no bash. The key stays in the gitignored env file; none lives here.
//
// Usage:
//   node .claude/provider-api-key.mjs                    # ANTHROPIC_API_KEY
//   node .claude/provider-api-key.mjs OPENROUTER_API_KEY
import { ENV_FILES, readEnv } from './env-file.mjs';

const name = process.argv[2] || 'ANTHROPIC_API_KEY';
const key = readEnv(name);

if (!key) {
  process.stderr.write(`apiKeyHelper: ${name} not set in ${ENV_FILES.join(' or ')}\n`);
  process.exit(1);
}

process.stdout.write(key);
