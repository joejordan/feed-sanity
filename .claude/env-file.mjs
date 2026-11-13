// Reads a single variable out of the repo-root scratch env file.
// Shared by provider-api-key.mjs (secrets) and auth-mode.mjs (model slugs).
//
// `.env-ignore` is searched first because that is where the real provider keys
// live; `.env` is kept as a fallback so an existing local setup keeps working.
// Both are gitignored — nothing here reads or writes a committed file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILES = ['.env-ignore', '.env'].map((f) => path.join(repoRoot, f));

/** Returns the variable's value, or '' when unset or no env file exists. */
export function readEnv(name) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  let value = '';

  for (const file of ENV_FILES) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Last matching assignment wins, and an earlier file wins over a later one.
    for (const line of text.split(/\r?\n/)) {
      const m = pattern.exec(line);
      if (m) value = m[1];
    }
    if (value) break;
  }

  return value
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1');
}
