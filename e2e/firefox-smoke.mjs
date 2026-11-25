// Automated Firefox MV2 smoke test using native W3C WebDriver BiDi (zero extra
// npm dependencies). Launches headless Firefox in an isolated temporary profile,
// loads `.output/firefox-mv2`, and verifies manifest metadata, MAIN-world
// PageBridge & Network Tap (fetch + XHR), Shadow DOM adoptedStyleSheets across
// Gecko Xray wrappers, slim Firefox scrollbars + stable gutter, experimental
// site gating, and zero extension console errors.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = path.join(ROOT_DIR, '.output', 'firefox-mv2');
const GECKO_ID = 'feed-sanity@burgtech.com';
const GECKO_MIN_VERSION = '140.0';
const GECKO_ANDROID_MIN_VERSION = '142.0';
const BIDI_TIMEOUT_MS = 20_000;

function findFirefoxBinary() {
  if (process.env.FIREFOX_BIN && fs.existsSync(process.env.FIREFOX_BIN)) {
    return process.env.FIREFOX_BIN;
  }
  const candidatesByPlatform = {
    win32: [
      'C:\\Program Files\\Firefox Developer Edition\\firefox.exe',
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    ],
    darwin: [
      '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
      '/Applications/Firefox.app/Contents/MacOS/firefox',
    ],
  };
  const candidates = candidatesByPlatform[process.platform] ?? [
    '/usr/bin/firefox',
    '/usr/local/bin/firefox',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const lookup = spawnSync(locator, ['firefox'], { encoding: 'utf8' });
  const fromPath = lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/)[0]?.trim() : '';
  if (fromPath && fs.existsSync(fromPath)) {
    return fromPath;
  }
  throw new Error(
    'Firefox binary not found. Install Firefox or set FIREFOX_BIN=/path/to/firefox before running pnpm test:firefox.',
  );
}

function startBiDiFirefox(firefoxBin, profileDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      firefoxBin,
      [
        '-headless',
        '-new-instance',
        '-no-remote',
        '-profile',
        profileDir,
        '--remote-debugging-port=0',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOZ_NO_REMOTE: '1' } },
    );
    let stderr = '';
    const cleanup = () => {
      clearTimeout(timeout);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onError);
      proc.stdout.resume();
      proc.stderr.resume();
    };
    const timeout = setTimeout(() => {
      cleanup();
      proc.kill();
      reject(new Error(`Timed out waiting for Firefox BiDi port.\n${stderr}`));
    }, BIDI_TIMEOUT_MS);

    const onData = (chunk) => {
      stderr += chunk.toString();
      const match = /WebDriver BiDi listening on (ws:\/\/\S+)\r?\n/i.exec(stderr);
      if (match) {
        cleanup();
        resolve({ proc, wsUrl: match[1] });
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Firefox exited early with code ${code}.\n${stderr}`));
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', onExit);
    proc.on('error', onError);
  });
}

function waitForExit(proc, timeoutMs = 4000) {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.off('exit', done);
      resolve();
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    proc.once('exit', done);
  });
}

function unwrapBiDi(remote) {
  if (!remote || typeof remote !== 'object') {
    return remote;
  }
  switch (remote.type) {
    case 'undefined':
      return;
    case 'null':
      return null;
    case 'string':
    case 'number':
    case 'boolean':
      return remote.value;
    case 'array':
      return (remote.value ?? []).map(unwrapBiDi);
    case 'object':
      return Object.fromEntries((remote.value ?? []).map(([k, v]) => [k, unwrapBiDi(v)]));
    default:
      return remote.value ?? remote;
  }
}

class BiDiClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];
    this.onRequest = null;

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.type === 'error') {
          entry.reject(new Error(`${msg.error}: ${msg.message}`));
        } else {
          entry.resolve(msg.result);
        }
      } else if (msg.method === 'log.entryAdded') {
        this.logs.push(msg.params);
      } else if (msg.method === 'network.beforeRequestSent' && msg.params?.isBlocked) {
        this.onRequest?.(msg.params);
      }
    });

    const failPending = (reason) => {
      for (const [id, entry] of this.pending) {
        this.pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
      }
    };
    ws.addEventListener('close', () => failPending('BiDi WebSocket closed'));
    ws.addEventListener('error', () => failPending('BiDi WebSocket error'));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BiDi timeout on ${method}`));
      }, BIDI_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.onRequest = null;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error('BiDi client closed'));
    }
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  async evalIn(context, fnBody) {
    const res = await this.send('script.evaluate', {
      expression: `(async () => { ${fnBody} })()`,
      target: { context },
      awaitPromise: true,
    });
    if (res.type === 'exception') {
      throw new Error(`Page exception: ${res.exceptionDetails?.text ?? JSON.stringify(res)}`);
    }
    return unwrapBiDi(res.result);
  }
}

const FB_MOCK_HTML = `<!doctype html>
<html class="__fb-dark-mode"><head><meta charset="utf-8"><title>Facebook Mock</title>
<style>
  body { background: #18191a; color: #e4e6eb; font-family: system-ui; margin: 0; }
  [data-pagelet="RightRail"] { width: 280px; position: fixed; right: 16px; top: 20px; }
</style>
</head><body>
  <div role="banner"><a aria-label="Home" href="/">Home</a></div>
  <div role="main">
    <div role="radiogroup" aria-label="Dark mode">
      <div role="radio" aria-checked="true">On</div>
      <div role="radio" aria-checked="false">Off</div>
    </div>
  </div>
  <div data-pagelet="RightRail">
    <div><div id="rr-list">
      <div id="rr-heading"><h3><span>Sponsored</span></h3></div>
      <div id="rr-ad"><a href="https://example.com/ad">Sidebar Promo</a></div>
      <div id="rr-bday"><h3><span>Birthdays</span></h3><div>Bob has a birthday today</div></div>
    </div></div>
  </div>
  <script>
    const attachFiber = (el, fiber) => { el['__reactFiber$ffsmoke'] = fiber; };
    const egoFn = () => null;
    egoFn.displayName = 'CometHomeRightSideEgoContainer';
    attachFiber(document.getElementById('rr-ad'), { type: 'div', return: { type: egoFn } });
    const bdayFn = () => null;
    bdayFn.displayName = 'CometHomeRightSideBirthdayReminders';
    attachFiber(document.getElementById('rr-bday'), { type: 'div', return: { type: bdayFn } });
  </script>
</body></html>`;

const X_MOCK_HTML = `<!doctype html>
<html style="color-scheme: dark"><head><meta charset="utf-8"><title>X Mock</title>
<style>
  html, body { background-color: rgb(0, 0, 0); color: rgb(231, 233, 234); font-family: system-ui; margin: 0; }
  .r-kemksi { background-color: rgb(0, 0, 0); }
  .r-1yadl64 { border: 0px solid rgb(0, 0, 0); }
  .r-icon-btn { border-width: 1px; border-style: solid; border-color: rgba(0, 0, 0, 0); border-radius: 9999px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; }
  [data-testid="primaryColumn"] { width: 600px; margin: 0 auto; background-color: rgb(0, 0, 0); }
  [data-testid="toolBar"] { display: flex; gap: 8px; padding: 8px; }
</style>
</head><body class="r-kemksi">
  <div id="react-root">
    <main role="main">
      <div data-testid="primaryColumn">
        <div role="radiogroup" aria-label="Background">
          <div role="radio" aria-checked="true">Lights out</div>
          <div role="radio" aria-checked="false">Default</div>
        </div>
        <div data-testid="toolBar">
          <div id="x-toolbar-tablist" role="tablist" data-testid="ScrollSnap-List">
            <button id="x-icon-btn" class="r-1yadl64 r-icon-btn" type="button" aria-label="Add photo">IMG</button>
          </div>
          <button data-testid="tweetButtonInline" type="button">Post</button>
        </div>
        <div data-testid="cellInnerDiv">
          <article id="x-organic" data-testid="tweet">
            <div data-testid="User-Name"><span>Alice</span></div>
            <div data-testid="tweetText">Organic tweet on Firefox</div>
          </article>
        </div>
        <div data-testid="cellInnerDiv">
          <article id="x-ad" data-testid="tweet">
            <div data-testid="User-Name"><span>PromoCo</span></div>
            <div data-testid="tweetText">Buy widgets</div>
            <span>Ad</span>
          </article>
        </div>
      </div>
    </main>
  </div>
</body></html>`;

const REDDIT_MOCK_HTML = `<!doctype html>
<html class="theme-dark"><head><meta charset="utf-8"><title>Reddit Mock</title>
<style>
  html, body { background-color: rgb(11, 20, 22); color: rgb(242, 244, 245); font-family: system-ui; margin: 0; }
</style>
</head><body>
  <main id="main-content">
    <shreddit-post id="reddit-post-1"></shreddit-post>
  </main>
  <script>
    const host = document.getElementById('reddit-post-1');
    const sr = host.attachShadow({ mode: 'open' });
    const adopted = new CSSStyleSheet();
    adopted.replaceSync('.shreddit-card { background-color: rgb(11, 20, 22); color: rgb(242, 244, 245); border: 1px solid rgb(51, 61, 66); padding: 12px; }');
    sr.adoptedStyleSheets = [adopted];
    const card = document.createElement('div');
    card.className = 'shreddit-card';
    card.textContent = 'Shadow DOM Reddit post with adoptedStyleSheets';
    sr.appendChild(card);
  </script>
</body></html>`;

const TIMELINE_JSON = JSON.stringify({
  data: {
    home: {
      home_timeline_urt: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              { entryId: 'tweet-1', content: { itemContent: { itemType: 'TimelineTweet' } } },
              {
                entryId: 'promoted-tweet-2',
                content: {
                  itemContent: {
                    itemType: 'TimelineTweet',
                    promotedMetadata: { impressionId: 'imp_1' },
                  },
                },
              },
            ],
          },
        ],
      },
    },
  },
});

const MOCK_ROUTES = [
  {
    hostname: 'www.facebook.com',
    pathname: '/settings/',
    body: FB_MOCK_HTML,
    contentType: 'text/html; charset=utf-8',
  },
  {
    hostname: 'x.com',
    pathname: '/settings/display',
    body: X_MOCK_HTML,
    contentType: 'text/html; charset=utf-8',
  },
  {
    hostname: 'x.com',
    pathname: '/i/api/graphql/QryHash123/HomeTimeline',
    body: TIMELINE_JSON,
    contentType: 'application/json',
  },
  {
    hostname: 'www.reddit.com',
    pathname: '/',
    body: REDDIT_MOCK_HTML,
    contentType: 'text/html; charset=utf-8',
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertManifest() {
  const manifestPath = path.join(EXT_DIR, 'manifest.json');
  assert.ok(
    fs.existsSync(manifestPath),
    `Firefox build not found at ${manifestPath}. Run "pnpm exec wxt build -b firefox" first.`,
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 2, 'Firefox build should stay on MV2');
  assert.equal(manifest.browser_specific_settings?.gecko?.id, GECKO_ID);
  assert.equal(manifest.browser_specific_settings?.gecko?.strict_min_version, GECKO_MIN_VERSION);
  assert.equal(
    manifest.browser_specific_settings?.gecko_android?.strict_min_version,
    GECKO_ANDROID_MIN_VERSION,
  );
  assert.deepEqual(manifest.permissions, ['storage']);
}

async function navigate(bidi, tab, url, settleMs = 1200) {
  await bidi.send('browsingContext.navigate', { context: tab, url, wait: 'complete' });
  await sleep(settleMs);
}

async function checkRedditDisabledByDefault(bidi, tab) {
  await navigate(bidi, tab, 'https://www.reddit.com/', 900);
  const res = await bidi.evalIn(
    tab,
    `return {
      styles: document.querySelectorAll('style[id^="feed_sanity"]').length,
      ui: document.querySelectorAll('feed-sanity-ui').length,
    };`,
  );
  assert.equal(res.styles, 0, 'Reddit should inject no styles while disabled by default');
  assert.equal(res.ui, 0, 'Reddit should mount no UI while disabled by default');
}

async function checkFacebook(bidi, tab) {
  await navigate(bidi, tab, 'https://www.facebook.com/settings/?tab=dark_mode_category', 1400);
  const fb = await bidi.evalIn(
    tab,
    `
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, timeoutMs = 4000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const val = fn();
        if (val) return val;
        await wait(50);
      }
      return fn();
    };
    const clickByText = async (container, selector, pattern, settleMs = 150) => {
      const btn = [...container.querySelectorAll(selector)].find((el) =>
        pattern instanceof RegExp ? pattern.test(el.textContent ?? '') : el.textContent?.includes(pattern),
      );
      btn?.click();
      await wait(settleMs);
      return btn;
    };

    const noticeBtn = await waitFor(() => {
      for (const h of document.querySelectorAll('feed-sanity-ui')) {
        const btn = [...(h.shadowRoot?.querySelectorAll('button') ?? [])].find((b) =>
          /Appearance|Feed Sanity/i.test(b.textContent ?? ''),
        );
        if (btn) return btn;
      }
      return null;
    });
    noticeBtn?.click();

    const root = await waitFor(() => {
      const host = [...document.querySelectorAll('feed-sanity-ui')].find((h) =>
        h.shadowRoot?.querySelector('dialog'),
      );
      return host?.shadowRoot ?? null;
    });
    if (!root) return { dialogMounted: false };

    await clickByText(root, 'button', 'Luminous Tide', 400);
    const tideRenderer = await waitFor(
      () => document.querySelector('[data-fs-renderer]')?.getAttribute('data-fs-renderer') ?? null,
    );
    await clickByText(root, 'button', /Apply to all sites/i, 200);

    await clickByText(root, 'button.section', 'Filtering', 150);
    const hideAds = [...root.querySelectorAll('label, .fs-row, .row')]
      .find((el) => /Hide ads/i.test(el.textContent ?? ''))
      ?.querySelector('input[type="checkbox"]');
    if (hideAds && !hideAds.checked) {
      hideAds.click();
      await wait(200);
    }
    const bulkText = [...root.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Bulk Keyword Blocklist'))
      ?.textContent?.trim();

    await clickByText(root, 'button.section', 'Feed & Reading', 120);
    const hasZucked = Boolean(root.textContent?.includes("aka getting 'Zucked'"));

    await clickByText(root, 'button.section', 'Sites', 150);
    const list = root.querySelector('.list');
    const listCs = list ? getComputedStyle(list) : null;
    const fbBtn = root.querySelector('button[aria-label="Disable Facebook"]');
    const beforeBox = fbBtn?.getBoundingClientRect();
    const hadRedditBefore = Boolean(root.querySelector('button[aria-label="Enable Reddit"]'));
    root.querySelector('input[aria-label="Show experimental sites"]')?.click();
    await wait(150);
    const afterBox = fbBtn?.getBoundingClientRect();
    root.querySelector('button[aria-label="Enable Reddit"]')?.click();
    await wait(200);
    const redditEnabled = Boolean(root.querySelector('button[aria-label="Disable Reddit"]'));

    const siteToggle = root.querySelector('input[aria-label="Enable Feed Sanity on Facebook"]');
    const statusEl = root.querySelector('.site-status');
    const activeH = statusEl?.getBoundingClientRect().height ?? 0;
    siteToggle?.click();
    await wait(150);
    const pausedText = statusEl?.textContent?.trim();
    const pausedH = statusEl?.getBoundingClientRect().height ?? 0;
    siteToggle?.click();
    await wait(450);

    await clickByText(root, 'button.section', 'Diagnostics', 250);
    const bridgeConnected = Boolean(
      await waitFor(() => /connected/i.test(root.querySelector('.list')?.textContent ?? '')),
    );
    const rrAdHidden = await waitFor(
      () => document.getElementById('rr-ad')?.getAttribute('data-feed-sanity-hidden') ?? null,
    );

    return {
      dialogMounted: true,
      tideRenderer,
      bulkText,
      hasZucked,
      scrollbarWidth: listCs?.scrollbarWidth,
      scrollbarGutter: listCs?.scrollbarGutter,
      gutterShiftX: beforeBox && afterBox ? Math.abs(afterBox.x - beforeBox.x) : -1,
      hadRedditBefore,
      redditEnabled,
      pausedText,
      activeH,
      pausedH,
      bridgeConnected,
      rrHeadingHidden: document.getElementById('rr-heading')?.getAttribute('data-feed-sanity-hidden'),
      rrAdHidden,
      rrBdayHidden: document.getElementById('rr-bday')?.hasAttribute('data-feed-sanity-hidden'),
    };
  `,
  );

  assert.equal(fb.dialogMounted, true);
  assert.ok(
    fb.tideRenderer === 'webgl' || fb.tideRenderer === 'css',
    `Unexpected renderer: ${fb.tideRenderer}`,
  );
  assert.equal(fb.bulkText, 'Bulk Keyword Blocklist');
  assert.equal(fb.hasZucked, true);
  assert.equal(fb.scrollbarWidth, 'thin');
  assert.equal(fb.scrollbarGutter, 'stable');
  assert.ok(fb.gutterShiftX >= 0 && fb.gutterShiftX <= 0.5, `Gutter shifted ${fb.gutterShiftX}px`);
  assert.equal(fb.hadRedditBefore, false);
  assert.equal(fb.redditEnabled, true);
  assert.equal(fb.pausedText, 'Paused here');
  assert.ok(Math.abs(fb.activeH - fb.pausedH) < 1, 'Paused status should stay single-line');
  assert.equal(fb.bridgeConnected, true, 'Facebook world:"MAIN" PageBridge must connect');
  assert.equal(fb.rrHeadingHidden, 'none', 'Orphan RightRail Sponsored heading should hide');
  assert.equal(fb.rrAdHidden, 'none', 'RightRail Sponsored unit should hide');
  assert.equal(fb.rrBdayHidden, false, 'RightRail Birthdays unit should stay visible');
}

async function checkX(bidi, tab) {
  await navigate(bidi, tab, 'https://x.com/settings/display', 1400);
  const x = await bidi.evalIn(
    tab,
    `
    const isStripped = (payload) => {
      const entries = payload?.data?.home?.home_timeline_urt?.instructions?.[0]?.entries ?? [];
      return entries.length === 1 && entries[0].entryId === 'tweet-1';
    };

    const res = await fetch('/i/api/graphql/QryHash123/HomeTimeline');
    const fetchStripped = isStripped(await res.json());

    const xhrJson = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/i/api/graphql/QryHash123/HomeTimeline');
      xhr.onload = () => resolve(JSON.parse(xhr.responseText));
      xhr.onerror = reject;
      xhr.send();
    });
    const xhrStripped = isStripped(xhrJson);

    const toolbar = document.querySelector('[data-testid="toolBar"]');
    const tablist = document.getElementById('x-toolbar-tablist');
    const iconBtn = document.getElementById('x-icon-btn');

    return {
      fetchStripped,
      xhrStripped,
      xOrganicHidden: document.getElementById('x-organic')?.hasAttribute('data-feed-sanity-hidden'),
      xAdHidden: document.getElementById('x-ad')?.getAttribute('data-feed-sanity-hidden'),
      toolbarBoxShadow: toolbar ? getComputedStyle(toolbar).boxShadow : null,
      tablistBg: tablist ? getComputedStyle(tablist).backgroundColor : null,
      iconBtnBorderTop: iconBtn ? getComputedStyle(iconBtn).borderTopColor : null,
      renderer: document.querySelector('[data-fs-renderer]')?.getAttribute('data-fs-renderer') ?? null,
    };
  `,
  );

  assert.equal(x.fetchStripped, true, 'X fetch() Network Tap must strip promoted entries');
  assert.equal(x.xhrStripped, true, 'X XHR Network Tap must strip promoted entries');
  assert.equal(x.xOrganicHidden, false);
  assert.equal(x.xAdHidden, 'none');
  assert.equal(x.toolbarBoxShadow, 'none');
  assert.equal(x.tablistBg, 'rgba(0, 0, 0, 0)', 'Composer toolbar tablist must stay transparent');
  assert.equal(x.iconBtnBorderTop, 'rgba(0, 0, 0, 0)');
  assert.ok(x.renderer === 'webgl' || x.renderer === 'css');
}

async function checkRedditShadowXray(bidi, tab) {
  await navigate(bidi, tab, 'https://www.reddit.com/', 1400);
  const reddit = await bidi.evalIn(
    tab,
    `
    const sr = document.getElementById('reddit-post-1')?.shadowRoot;
    const adaptive = sr?.getElementById('feed_sanity_adaptive_theme');
    const card = sr?.querySelector('.shreddit-card');
    return {
      hasAdaptiveInShadow: Boolean(adaptive),
      compiledAdoptedRule: Boolean(adaptive?.textContent?.includes('.shreddit-card')),
      cardHealBg: card?.getAttribute('data-fs-heal-bg'),
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
    };
  `,
  );

  assert.equal(reddit.hasAdaptiveInShadow, true, 'Adaptive CSS must inject into open ShadowRoot');
  assert.equal(
    reddit.compiledAdoptedRule,
    true,
    'Adaptive compiler must read shadowRoot.adoptedStyleSheets across Gecko Xray',
  );
  assert.equal(
    reddit.cardHealBg,
    null,
    'Layer 1 should theme adoptedStyleSheets without Layer 2 fallback',
  );
  assert.notEqual(reddit.cardBg, 'rgb(11, 20, 22)', 'Shadow card background should be themed');
}

async function main() {
  assertManifest();
  const firefoxBin = findFirefoxBinary();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-ff-smoke-'));
  let proc;
  let bidi;

  try {
    fs.writeFileSync(
      path.join(profileDir, 'user.js'),
      [
        'user_pref("remote.active-protocols", 1);',
        'user_pref("xpinstall.signatures.required", false);',
        'user_pref("extensions.experiments.enabled", true);',
        'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("webgl.force-enabled", true);',
      ].join('\n'),
    );

    const started = await startBiDiFirefox(firefoxBin, profileDir);
    proc = started.proc;

    const ws = new WebSocket(`${started.wsUrl}/session`);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    bidi = new BiDiClient(ws);

    const session = await bidi.send('session.new', {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
    });
    console.log(
      `Firefox BiDi smoke (${session.capabilities.browserName} ${session.capabilities.browserVersion})`,
    );

    await bidi.send('session.subscribe', {
      events: ['log.entryAdded', 'network.beforeRequestSent'],
    });
    await bidi.send('network.addIntercept', {
      phases: ['beforeRequestSent'],
      urlPatterns: MOCK_ROUTES.map(({ hostname, pathname }) => ({
        type: 'pattern',
        protocol: 'https',
        hostname,
        pathname,
      })),
    });

    bidi.onRequest = (params) => {
      const parsed = new URL(params.request?.url ?? 'https://invalid.local/');
      const route = MOCK_ROUTES.find(
        (candidate) =>
          candidate.hostname === parsed.hostname && candidate.pathname === parsed.pathname,
      );
      void bidi
        .send('network.provideResponse', {
          request: params.request.request,
          statusCode: route ? 200 : 404,
          reasonPhrase: route ? 'OK' : 'Not Found',
          headers: [
            {
              name: 'content-type',
              value: { type: 'string', value: route?.contentType ?? 'text/plain' },
            },
          ],
          body: { type: 'string', value: route?.body ?? '' },
        })
        .catch(() => undefined);
    };

    const installed = await bidi.send('webExtension.install', {
      extensionData: { type: 'path', path: EXT_DIR },
    });
    assert.equal(installed.extension, GECKO_ID);

    const tree = await bidi.send('browsingContext.getTree');
    const tab = tree.contexts[0].context;

    await checkRedditDisabledByDefault(bidi, tab);
    await checkFacebook(bidi, tab);
    await checkX(bidi, tab);
    await checkRedditShadowXray(bidi, tab);

    const errors = bidi.logs.filter((entry) => entry.level === 'error');
    assert.equal(
      errors.length,
      0,
      `Expected 0 Firefox console errors, got ${errors.length}: ${errors.map((e) => e.text).join('; ')}`,
    );

    console.log('PASS: all Firefox MV2 smoke checks passed with 0 console errors.');
    await bidi.send('session.end').catch(() => undefined);
  } finally {
    bidi?.close();
    if (proc) {
      proc.kill();
      await waitForExit(proc);
    }
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((err) => {
  console.error('Firefox smoke test failed:', err);
  process.exit(1);
});
