#!/usr/bin/env node
// PreToolUse hook for Bash: refuses a git commit or gh pr command whose text
// carries an attribution line (Claude-Session, a claude.ai session link, or a
// Co-Authored-By naming Claude). Exit code 2 blocks the call and shows the
// message to the model, which then retries without the line.
import { readFileSync } from 'node:fs';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
}
catch {
  process.exit(0);
}

const command = input?.tool_input?.command ?? '';
if (!/\bgit\s+commit\b|\bgh\s+pr\b/.test(command))
  process.exit(0);

const attribution = [
  /^\s*Claude-Session:/im,
  /https:\/\/claude\.ai\/code\/session_/i,
  /^\s*Co-Authored-By:.*\bClaude\b/im,
  /Generated with \[?Claude Code/i,
];
if (attribution.some((pattern) => pattern.test(command))) {
  process.stderr.write(
    'Blocked: commit messages and PR descriptions in this repo carry no attribution '
    + 'lines (no Claude-Session, session link or Co-Authored-By). Remove the line and retry.\n',
  );
  process.exit(2);
}
process.exit(0);
