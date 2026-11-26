// Cross-platform Safari MV3 manifest and bundle smoke check (zero extra deps).
// Verifies `.output/safari-mv3` has valid Safari MV3 structure, all 4 unlisted
// MAIN-world bundles, zero unsupported manifest keys, and zero Safari bleed into
// `.output/chrome-mv3` or `.output/firefox-mv2`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFARI_DIR = path.join(ROOT_DIR, '.output', 'safari-mv3');
const CHROME_DIR = path.join(ROOT_DIR, '.output', 'chrome-mv3');
const FIREFOX_DIR = path.join(ROOT_DIR, '.output', 'firefox-mv2');

const EXPECTED_SAFARI_PAGE_WORLD_FILES = [
  'safari-facebook-page-world.js',
  'safari-x-page-world.js',
  'safari-instagram-page-world.js',
  'safari-reddit-page-world.js',
];

function readJson(filePath) {
  assert.ok(fs.existsSync(filePath), `Missing expected build artifact: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function verifySafariBuild() {
  const manifest = readJson(path.join(SAFARI_DIR, 'manifest.json'));
  assert.equal(manifest.manifest_version, 3, 'Safari build must target Manifest V3');
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
  assert.ok(Array.isArray(manifest.host_permissions), 'Safari manifest must set host_permissions');
  assert.ok(
    manifest.host_permissions.includes('https://*.facebook.com/*'),
    'Safari host_permissions must cover Facebook',
  );
  assert.ok(
    manifest.host_permissions.includes('https://x.com/*'),
    'Safari host_permissions must cover X',
  );
  assert.ok(
    manifest.host_permissions.includes('https://www.instagram.com/*'),
    'Safari host_permissions must cover Instagram',
  );
  assert.ok(
    manifest.host_permissions.includes('https://www.reddit.com/*'),
    'Safari host_permissions must cover Reddit',
  );
  assert.ok(
    manifest.host_permissions.includes('https://mail.google.com/*'),
    'Safari host_permissions must cover Gmail for automatic open-tab attachment',
  );

  assert.deepEqual(manifest.browser_specific_settings, {
    safari: { strict_min_version: '17.0' },
  });
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.equal(manifest.action?.default_popup, 'popup.html');
  assert.ok(manifest.icons?.['128'], 'Safari manifest must declare 128px icon');

  assert.ok(Array.isArray(manifest.content_scripts), 'Safari manifest must have content_scripts');
  assert.equal(
    manifest.content_scripts.length,
    5,
    'Safari manifest should only declare the 5 isolated-world site content scripts',
  );
  for (const script of manifest.content_scripts) {
    assert.equal('world' in script, false, 'Safari manifest must not emit unsupported `world` key');
    assert.equal(
      'exclude_globs' in script,
      false,
      'Safari manifest must not emit unsupported `exclude_globs` key',
    );
    assert.ok(
      !script.js.some((file) => file.includes('page-world')),
      `Safari content_scripts must not statically include page-world script: ${script.js.join(', ')}`,
    );
  }

  for (const filename of EXPECTED_SAFARI_PAGE_WORLD_FILES) {
    const filePath = path.join(SAFARI_DIR, filename);
    assert.ok(fs.existsSync(filePath), `Missing Safari unlisted MAIN-world bundle: ${filename}`);
    const code = fs.readFileSync(filePath, 'utf8');
    assert.ok(code.length > 100, `Expected non-empty bundle: ${filename}`);
    assert.match(
      code.trimStart(),
      /^\(function\s*\(/,
      `Safari MAIN-world bundle ${filename} must be an anonymous IIFE leaving no global`,
    );
  }

  const bgCode = fs.readFileSync(path.join(SAFARI_DIR, 'background.js'), 'utf8');
  assert.ok(
    bgCode.includes('registerContentScripts'),
    'Safari background.js must register dynamic MAIN-world content scripts',
  );
  assert.ok(
    bgCode.includes('feed-sanity/request-page-world'),
    'Safari background.js must handle cold-start REQUEST_PAGE_WORLD fallback',
  );
}

function verifyNoSafariBleed(dir, label, expectedManifestVersion) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  assert.equal(manifest.manifest_version, expectedManifestVersion);
  if (label === 'Chrome') {
    assert.deepEqual(
      manifest.permissions,
      ['storage', 'scripting'],
      'Chrome MV3 permissions must stay strictly [storage, scripting]',
    );
    assert.ok(
      Array.isArray(manifest.host_permissions) &&
        manifest.host_permissions.includes('https://*.facebook.com/*') &&
        manifest.host_permissions.includes('https://mail.google.com/*'),
      'Chrome MV3 host_permissions must cover all 5 supported sites',
    );
    assert.equal(
      'browser_specific_settings' in manifest,
      false,
      'Chrome manifest must not contain browser_specific_settings',
    );
  } else {
    assert.ok(
      Array.isArray(manifest.permissions) &&
        manifest.permissions.includes('storage') &&
        manifest.permissions.includes('scripting') &&
        manifest.permissions.includes('https://*.facebook.com/*') &&
        manifest.permissions.includes('https://mail.google.com/*'),
      'Firefox MV2 permissions must include storage, scripting, and the 5 supported sites',
    );
    assert.equal(
      'host_permissions' in manifest,
      false,
      'Firefox MV2 must declare host patterns in permissions, not host_permissions',
    );
    assert.equal(
      'safari' in (manifest.browser_specific_settings ?? {}),
      false,
      'Firefox manifest must not contain Safari browser_specific_settings',
    );
  }

  for (const filename of EXPECTED_SAFARI_PAGE_WORLD_FILES) {
    assert.equal(
      fs.existsSync(path.join(dir, filename)),
      false,
      `${label} build must not emit Safari unlisted script ${filename}`,
    );
  }

  const bgCode = fs.readFileSync(path.join(dir, 'background.js'), 'utf8');
  assert.equal(
    bgCode.includes('feed-sanity/request-page-world'),
    false,
    `${label} background.js must dead-code eliminate Safari page-world loader`,
  );
  assert.equal(
    bgCode.includes('registerContentScripts'),
    false,
    `${label} background.js must not include Safari registerContentScripts`,
  );
  assert.equal(
    bgCode.includes('feed-sanity-facebook-page-world') ||
      bgCode.includes('/safari-') ||
      /feed-sanity-.*-page-world/.test(bgCode),
    false,
    `${label} background.js must tree-shake Safari page-world specs completely`,
  );
  const fbContent = fs.readFileSync(path.join(dir, 'content-scripts', 'facebook.js'), 'utf8');
  assert.equal(
    fbContent.includes('feed-sanity/request-page-world') || fbContent.includes('/safari-'),
    false,
    `${label} content scripts must dead-code eliminate Safari cold-start messaging`,
  );
}

verifySafariBuild();
verifyNoSafariBleed(CHROME_DIR, 'Chrome', 3);
verifyNoSafariBleed(FIREFOX_DIR, 'Firefox', 2);
console.log('Safari MV3 manifest & cross-browser isolation smoke checks passed.');
