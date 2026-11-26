// Automated macOS Safari Web Extension E2E suite powered by Apple's native
// `WKWebExtension` / `WKWebExtensionController` runtime (zero extra npm deps).
//
// Compiles `e2e/safari-wkwebextension-runner.swift` (cached by mtime) and runs
// `.output/safari-mv3` (and optionally the signed `.appex` bundle) through:
//   1. Manifest + background service worker + dynamic `registerContentScripts`
//   2. Toolbar popup rendering & exact dimensions (360px wide) on unsupported & Facebook tabs
//   3. Interactive popup -> live tab theme apply & reset via `browser.storage.local`
//   4. Facebook post tracking, ID extraction, Mark Read buttons, and MAIN-world PageBridge
//   5. Facebook stress & responsiveness benchmark (20,000 CSS rules, 120+ posts, videos, SPA nav)
//   6. Multi-site checks (X, Instagram, Reddit, Gmail) & `static.*.facebook.com` exclusion
//
// Usage:
//   node e2e/safari-smoke.mjs [--appex] [--json]

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SWIFT_SOURCE = path.join(ROOT_DIR, 'e2e', 'safari-wkwebextension-runner.swift');
const RUNNER_BIN = path.join(ROOT_DIR, '.output', 'safari-wkwebextension-runner');
const SAFARI_MV3_DIR = path.join(ROOT_DIR, '.output', 'safari-mv3');
const SIGNED_APPEX = path.join(
  ROOT_DIR,
  '.output',
  'safari-xcode',
  'build',
  'Feed Sanity.app',
  'Contents',
  'PlugIns',
  'Feed Sanity Extension.appex',
);
const FIXTURES_DIR = path.join(ROOT_DIR, 'e2e', 'pages');

function ensureMacOsSupport() {
  if (process.platform !== 'darwin') {
    throw new Error(
      'pnpm test:safari requires macOS 15.4+ (WKWebExtension). Run `pnpm test:safari:manifest` on Linux/Windows.',
    );
  }
  const versionStr = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  const [major = 0, minor = 0] = versionStr.split('.').map((n) => Number.parseInt(n, 10) || 0);
  if (major < 15 || (major === 15 && minor < 4)) {
    throw new Error(`WKWebExtension requires macOS 15.4+, found ${versionStr}.`);
  }
}

function ensureRunnerCompiled() {
  fs.mkdirSync(path.dirname(RUNNER_BIN), { recursive: true });
  const needsCompile =
    !fs.existsSync(RUNNER_BIN) ||
    fs.statSync(RUNNER_BIN).mtimeMs < fs.statSync(SWIFT_SOURCE).mtimeMs;
  if (needsCompile) {
    execFileSync(
      'swiftc',
      ['-O', '-framework', 'Cocoa', '-framework', 'WebKit', SWIFT_SOURCE, '-o', RUNNER_BIN],
      { cwd: ROOT_DIR, stdio: 'inherit' },
    );
  }
}

function runTarget(targetPath) {
  const stdout = execFileSync(RUNNER_BIN, ['--extension', targetPath, '--fixtures', FIXTURES_DIR], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(stdout);
}

function assertPopup(popup, expected) {
  assert.equal(popup.error, undefined, `Popup (${popup.label}) error: ${popup.error}`);
  assert.equal(popup.presentsPopup, true, `Popup (${popup.label}) must report presentsPopup=true`);
  assert.equal(
    popup.presentedByPerformAction,
    true,
    `Popup (${popup.label}) must present on performAction`,
  );
  assert.equal(
    popup.renderedWithin4s,
    true,
    `Popup (${popup.label}) failed to render #root within 4s`,
  );
  assert.deepEqual(popup.contextErrors, [], `Popup (${popup.label}) produced context errors`);

  const { dom } = popup;
  assert.ok(dom, `Popup (${popup.label}) missing DOM measurements`);
  assert.ok(dom.rootChildren > 0, `Popup (${popup.label}) rendered empty #root`);
  assert.equal(
    dom.htmlSize.w,
    360,
    `Popup (${popup.label}) collapsed or mis-sized width: expected 360px, got ${dom.htmlSize.w}px`,
  );
  assert.equal(
    dom.qpRootSize.w,
    360,
    `Popup (${popup.label}) .qp-root width must be 360px, got ${dom.qpRootSize.w}px`,
  );
  assert.ok(
    dom.htmlSize.h >= expected.minHeight,
    `Popup (${popup.label}) height too small: expected >= ${expected.minHeight}px, got ${dom.htmlSize.h}px`,
  );
  for (const snippet of expected.textIncludes) {
    assert.ok(
      dom.bodyText.includes(snippet),
      `Popup (${popup.label}) missing expected text "${snippet}". Got:\n${dom.bodyText}`,
    );
  }
}

function assertReport(report, label) {
  assert.equal(report.fatalError, undefined, `[${label}] Fatal error: ${report.fatalError}`);
  assert.equal(
    report.backgroundLoadError,
    undefined,
    `[${label}] Background load error: ${report.backgroundLoadError}`,
  );
  assert.deepEqual(report.extensionLoad.parseErrors, [], `[${label}] Manifest parse errors`);
  assert.deepEqual(report.afterBackgroundErrors, [], `[${label}] Background context errors`);
  assert.deepEqual(report.finalContextErrors, [], `[${label}] Final context errors`);
  assert.equal(report.extensionLoad.manifestVersion, 3, `[${label}] Expected MV3`);
  assert.equal(report.extensionLoad.hasBackgroundContent, true);
  assert.equal(report.extensionLoad.hasInjectedContent, true);

  // 1) Popup on unsupported tab
  assertPopup(report.popupUnsupported, {
    minHeight: 180,
    textIncludes: ['Not active on this page', 'Facebook', 'X (Twitter)'],
  });

  // 2) Popup on Facebook + interactive live theme apply & clear
  assertPopup(report.popupFacebook, {
    minHeight: 380,
    textIncludes: [
      'Facebook',
      'Active on this tab',
      'Hide suggested posts',
      'Mark posts as read',
      'All Facebook settings',
    ],
  });
  const interaction = report.popupFacebook.interaction;
  assert.ok(interaction, `[${label}] Missing popup theme interaction result`);
  assert.equal(interaction.clickedPreset, true, `[${label}] Failed to click preset swatch`);
  assert.equal(
    interaction.themeAppliedOnTab,
    true,
    `[${label}] Theme selected in popup did not apply to live Facebook tab`,
  );
  assert.ok(
    interaction.themeCssLength > 100,
    `[${label}] Applied theme CSS was unexpectedly short (${interaction.themeCssLength} chars)`,
  );
  assert.equal(
    interaction.themeClearedOnTab,
    true,
    `[${label}] Selecting Site Default in popup did not clear theme from Facebook tab`,
  );

  // 3) Facebook fixture & MAIN-world PageBridge
  const fb = report.facebook;
  assert.equal(fb.postsTracked, true, `[${label}] Facebook content script did not track posts`);
  assert.ok(fb.state.posts >= 5, `[${label}] Expected >= 5 tracked posts, got ${fb.state.posts}`);
  assert.ok(fb.state.withId >= 4, `[${label}] Expected >= 4 posts with ID, got ${fb.state.withId}`);
  assert.equal(fb.state.hasOwnUi, true, `[${label}] Expected Feed Sanity UI on Facebook`);
  assert.deepEqual(fb.console, [], `[${label}] Unexpected console errors on Facebook`);
  assert.ok(
    fb.state.bridge.readyEvents >= 1,
    `[${label}] safari-facebook-page-world.js did not fire READY_EVENT`,
  );
  assert.equal(fb.state.bridge.connected, true, `[${label}] Facebook PageBridge did not connect`);
  for (const reader of [
    'video-sources',
    'post-sponsored',
    'composer-info',
    'right-rail-sponsored',
  ]) {
    assert.ok(
      fb.state.bridge.readers.includes(reader),
      `[${label}] Facebook PageBridge missing reader ${reader}`,
    );
  }
  assert.ok(
    fb.state.bridge.toggles.includes('stop-feed-refresh'),
    `[${label}] Facebook PageBridge missing stop-feed-refresh toggle`,
  );

  // 4) Facebook stress & responsiveness benchmark
  const perf = report.facebookPerf;
  assert.deepEqual(
    perf.consoleErrors,
    [],
    `[${label}] Facebook stress test produced console/page errors (e.g. ResizeObserver loop): ${JSON.stringify(perf.consoleErrors)}`,
  );
  assert.equal(perf.metrics.done, true, `[${label}] Facebook stress test did not finish`);
  assert.ok(
    perf.metrics.trackedPosts >= 120,
    `[${label}] Expected >= 120 tracked posts under stress, got ${perf.metrics.trackedPosts}`,
  );
  assert.ok(
    perf.metrics.markReadButtons >= 120,
    `[${label}] Expected >= 120 Mark Read buttons under stress, got ${perf.metrics.markReadButtons}`,
  );
  assert.ok(
    perf.metrics.maxBatchBlockMs <= 100,
    `[${label}] Main-thread stall too high under Facebook stress: maxBatchBlockMs=${perf.metrics.maxBatchBlockMs}ms (limit 100ms)`,
  );
  assert.ok(
    perf.metrics.totalBatchBlockMs <= 300,
    `[${label}] Total main-thread blocking too high under Facebook stress: totalBatchBlockMs=${perf.metrics.totalBatchBlockMs}ms (limit 300ms)`,
  );

  // 5) Facebook static host exclusion
  assert.equal(
    report.facebookStaticExcluded.postsTracked,
    0,
    `[${label}] static.xx.facebook.com must not track posts`,
  );
  assert.equal(
    report.facebookStaticExcluded.bridge.readyEvents,
    0,
    `[${label}] static.xx.facebook.com must not run MAIN-world script`,
  );
  assert.equal(report.facebookStaticExcluded.bridge.connected, false);

  // 6) Multi-site checks (X, Instagram, Reddit, Gmail)
  const { x, instagram, reddit, gmail } = report.sites;
  assert.deepEqual(x.consoleErrors, [], `[${label}] X console errors`);
  assert.ok(x.probe.bridge.readyEvents >= 1, `[${label}] X MAIN-world script did not run`);
  assert.equal(x.probe.bridge.connected, true, `[${label}] X PageBridge did not connect`);
  assert.ok(x.probe.bridge.readers.includes('x-tweet-meta'));
  assert.ok(x.probe.bridge.toggles.includes('x-strip-promoted'));

  assert.deepEqual(instagram.consoleErrors, [], `[${label}] Instagram console errors`);
  assert.ok(
    instagram.probe.bridge.readyEvents >= 1,
    `[${label}] Instagram MAIN-world script did not run`,
  );

  assert.deepEqual(reddit.consoleErrors, [], `[${label}] Reddit console errors`);
  assert.ok(
    reddit.probe.bridge.readyEvents >= 1,
    `[${label}] Reddit MAIN-world script did not run`,
  );

  assert.deepEqual(gmail.consoleErrors, [], `[${label}] Gmail console errors`);
  assert.equal(
    gmail.probe.bridge.readyEvents,
    0,
    `[${label}] Gmail must not run any MAIN-world script`,
  );

  // 7) Pre-existing open tab auto-attach + live reload/upgrade without tab refresh
  const auto = report.autoAttach;
  assert.ok(auto, `[${label}] Missing autoAttach report`);
  assert.equal(auto.error, undefined, `[${label}] autoAttach error: ${auto.error}`);
  assert.deepEqual(auto.consoleErrors, [], `[${label}] autoAttach console errors`);
  assert.deepEqual(auto.contextAErrors, [], `[${label}] autoAttach contextA errors`);
  assert.deepEqual(auto.contextBErrors, [], `[${label}] autoAttach contextB errors`);
  assert.equal(auto.beforeInstall.posts, 0, `[${label}] Pre-install tab must start unattached`);
  assert.equal(
    auto.attachedInitial,
    true,
    `[${label}] Pre-existing Facebook tab did not auto-attach on extension load without refresh`,
  );
  assert.ok(auto.afterInstall.posts >= 5, `[${label}] Expected >= 5 posts after auto-attach`);
  assert.equal(
    auto.afterInstall.markRead,
    auto.afterInstall.posts,
    `[${label}] Expected 1 Mark Read button per post after auto-attach`,
  );
  assertPopup(auto.popupAfterInstall, {
    minHeight: 380,
    textIncludes: ['Facebook', 'Active on this tab'],
  });
  assert.equal(
    auto.upgradedLive,
    true,
    `[${label}] Open Facebook tab did not live-upgrade on extension reload without refresh`,
  );
  assert.ok(
    auto.afterUpgrade.channelsSeen >= 2,
    `[${label}] Expected fresh PageBridge channel after live upgrade`,
  );
  assert.equal(
    auto.afterUpgrade.posts,
    auto.afterInstall.posts,
    `[${label}] Live upgrade changed tracked post count (${auto.afterInstall.posts} -> ${auto.afterUpgrade.posts})`,
  );
  assert.equal(
    auto.afterUpgrade.markRead,
    auto.afterUpgrade.posts,
    `[${label}] Live upgrade left duplicate or missing Mark Read buttons (${auto.afterUpgrade.markRead} for ${auto.afterUpgrade.posts} posts)`,
  );
  assertPopup(auto.popupAfterUpgrade, {
    minHeight: 380,
    textIncludes: ['Facebook', 'Active on this tab'],
  });
}

function main() {
  ensureMacOsSupport();
  assert.ok(
    fs.existsSync(path.join(SAFARI_MV3_DIR, 'manifest.json')),
    `Missing ${SAFARI_MV3_DIR}. Run \`pnpm build:safari\` first.`,
  );
  ensureRunnerCompiled();

  const args = new Set(process.argv.slice(2));
  const checkAppex = args.has('--appex');
  const printJson = args.has('--json');

  const mv3Report = runTarget(SAFARI_MV3_DIR);
  if (printJson) {
    console.log(JSON.stringify(mv3Report, null, 2));
  }
  assertReport(mv3Report, 'safari-mv3');
  console.log(
    `[PASS] safari-mv3: popup ${mv3Report.popupFacebook.dom.htmlSize.w}x${mv3Report.popupFacebook.dom.htmlSize.h}px (live theme apply+reset), ` +
      `5 sites verified, FB stress max=${mv3Report.facebookPerf.metrics.maxBatchBlockMs}ms total=${mv3Report.facebookPerf.metrics.totalBatchBlockMs}ms (0 console errors).`,
  );

  if (checkAppex) {
    assert.ok(
      fs.existsSync(SIGNED_APPEX),
      `Missing signed .appex at ${SIGNED_APPEX}. Run \`pnpm build:safari-xcode\` first.`,
    );
    const appexReport = runTarget(SIGNED_APPEX);
    assertReport(appexReport, 'Feed Sanity Extension.appex');
    console.log(
      `[PASS] Feed Sanity Extension.appex: signed bundle verified in WKWebExtension ` +
        `(popup ${appexReport.popupFacebook.dom.htmlSize.w}x${appexReport.popupFacebook.dom.htmlSize.h}px, ` +
        `FB stress max=${appexReport.facebookPerf.metrics.maxBatchBlockMs}ms).`,
    );
  }
}

main();
