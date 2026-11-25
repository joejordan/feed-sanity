// Bumps `package.json`'s `version` field (single source of truth for Chrome MV3,
// Firefox MV2, and the userscript `@version` header) after validating store-safe x.y.z SemVer.
// Usage: node scripts/bump-version.mjs 0.1.0

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Chrome MV3 and Firefox AMO manifests only accept numeric dot-separated versions.
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const nextVersion = process.argv[2]?.replace(/^v/, '') ?? '';
if (!SEMVER_RE.test(nextVersion)) {
  console.error('Usage: pnpm version:bump <x.y.z>  (example: pnpm version:bump 0.1.0)');
  process.exit(1);
}

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const prevVersion = pkg.version;

if (prevVersion === nextVersion) {
  console.log(`package.json is already at version ${nextVersion}.`);
  process.exit(0);
}

pkg.version = nextVersion;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

console.log(`Updated package.json: ${prevVersion} -> ${nextVersion}`);
console.log('Next steps:');
console.log(
  `  1. Commit: git commit package.json -m "chore(release): bump version to ${nextVersion}"`,
);
console.log(`  2. Tag:    git tag v${nextVersion}`);
console.log('  3. Push:   git push && git push --tags');
