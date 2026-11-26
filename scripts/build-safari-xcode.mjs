// Wraps `.output/safari-mv3` in a branded Xcode Safari Web Extension app using
// Apple's `xcrun safari-web-extension-converter`, generates AppIcon assets via
// `sips`, builds with `xcodebuild` (signed with Apple Development by default on
// macOS), and optionally registers + opens the built app.
//
// Usage:
//   node scripts/build-safari-xcode.mjs [--all-platforms] [--no-sign] [--open] [--skip-build] [--ios-sim]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = path.join(ROOT_DIR, '.output', 'safari-mv3');
const XCODE_OUT_DIR = path.join(ROOT_DIR, '.output', 'safari-xcode');
const PROJECT_DIR = path.join(XCODE_OUT_DIR, 'Feed Sanity');
const XCODEPROJ = path.join(PROJECT_DIR, 'Feed Sanity.xcodeproj');
const BUILD_DIR = path.join(XCODE_OUT_DIR, 'build');
const APP_NAME = 'Feed Sanity';
// Match `--app-name` casing so `safari-web-extension-converter` keeps the parent
// app and `.appex` bundle identifiers aligned for Xcode's ValidateEmbeddedBinary.
const BUNDLE_ID = 'com.burgtech.Feed-Sanity';

const MAC_ICON_SOURCE = path.join(ROOT_DIR, 'assets', 'safari', 'macos-app-icon-1024.png');
const IOS_ICON_SOURCE = path.join(ROOT_DIR, 'assets', 'safari', 'ios-app-icon-1024.png');
const FALLBACK_ICON_SOURCE = path.join(ROOT_DIR, 'public', 'icon', 'icon-128.png');

const MAC_ICON_SIZES = [
  ['mac-icon-16@1x.png', 16],
  ['mac-icon-16@2x.png', 32],
  ['mac-icon-32@1x.png', 32],
  ['mac-icon-32@2x.png', 64],
  ['mac-icon-128@1x.png', 128],
  ['mac-icon-128@2x.png', 256],
  ['mac-icon-256@1x.png', 256],
  ['mac-icon-256@2x.png', 512],
  ['mac-icon-512@1x.png', 512],
  ['mac-icon-512@2x.png', 1024],
];

const BRANDED_MAIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <title>Feed Sanity for Safari</title>
    <link rel="stylesheet" href="../Style.css">
    <script src="../Script.js" defer></script>
</head>
<body>
    <main class="shell">
        <div class="hero">
            <img class="mark" src="../Icon.png" width="96" height="96" alt="Feed Sanity Icon">
            <h1>Feed Sanity</h1>
            <p class="tagline">Your feed, minus the noise.</p>
        </div>

        <section class="status-card" aria-live="polite">
            <p class="platform-ios">Turn on Feed Sanity in Settings &rarr; Apps &rarr; Safari &rarr; Extensions, then allow access on your supported feeds.</p>
            <p class="platform-mac state-unknown">Turn on Feed Sanity in Safari Extensions settings to start filtering and theming your feeds.</p>
            <p class="platform-mac state-on">Feed Sanity is enabled in Safari. You can manage site permissions anytime in Safari Settings.</p>
            <p class="platform-mac state-off">Feed Sanity is currently off in Safari. Enable it below to activate filtering and themes.</p>
        </section>

        <ol class="steps">
            <li><span class="step-num">1</span><span>Enable <strong>Feed Sanity</strong> in Safari Extensions.</span></li>
            <li><span class="step-num">2</span><span>Allow access on supported sites and click the toolbar icon to customize.</span></li>
        </ol>

        <ul class="sites" aria-label="Supported sites">
            <li>Facebook</li>
            <li>X</li>
            <li>Instagram</li>
            <li>Reddit</li>
            <li>Gmail</li>
        </ul>

        <button class="platform-mac open-preferences" type="button">Quit and Open Safari Extensions Preferences…</button>
    </main>
</body>
</html>
`;

const BRANDED_STYLE_CSS = `* {
    box-sizing: border-box;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    cursor: default;
}

:root {
    color-scheme: light dark;
    --bg: #f8fafc;
    --surface: #eef3f9;
    --card: #ffffff;
    --border: rgba(23, 54, 102, 0.14);
    --text: #070b1f;
    --muted: #4a5a7a;
    --accent: #0b6b8f;
    --accent-soft: rgba(11, 107, 143, 0.12);
    --accent-fg: #ffffff;
    --shadow: 0 12px 32px rgba(7, 11, 31, 0.1);
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #070b1f;
        --surface: #0e1a3d;
        --card: #101e46;
        --border: rgba(159, 179, 209, 0.2);
        --text: #fffcee;
        --muted: #9fb3d1;
        --accent: #5be9e0;
        --accent-soft: rgba(91, 233, 224, 0.14);
        --accent-fg: #070b1f;
        --shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    }
}

html,
body {
    height: 100%;
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.45;
}

body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
}

.shell {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    text-align: center;
}

.hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}

.mark {
    border-radius: 22px;
    box-shadow: var(--shadow);
}

h1 {
    margin: 8px 0 0;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
}

.tagline {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
}

.status-card {
    width: 100%;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
}

.status-card p {
    margin: 0;
    font-size: 13px;
}

.steps {
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
}

.steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 13px;
}

.step-num {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
}

.sites {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
}

.sites li {
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
}

button.open-preferences {
    width: 100%;
    padding: 10px 16px;
    border: 0;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 120ms ease, transform 120ms ease;
}

button.open-preferences:hover {
    opacity: 0.92;
}

button.open-preferences:active {
    transform: scale(0.99);
}

body:not(.platform-mac, .platform-ios) :is(.platform-mac, .platform-ios) {
    display: none;
}

body.platform-ios .platform-mac {
    display: none;
}

body.platform-mac .platform-ios {
    display: none;
}

body:not(.state-on, .state-off) :is(.state-on, .state-off) {
    display: none;
}

body.state-on :is(.state-off, .state-unknown) {
    display: none;
}

body.state-off :is(.state-on, .state-unknown) {
    display: none;
}
`;

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  });
}

function resizePng(src, dest, size) {
  run('sips', ['-z', String(size), String(size), src, '--out', dest], { capture: true });
}

function detectAppleDevelopmentTeam() {
  if (process.env.SAFARI_TEAM_ID) {
    return process.env.SAFARI_TEAM_ID.trim();
  }
  try {
    const pem = run('security', ['find-certificate', '-c', 'Apple Development', '-p'], {
      capture: true,
    });
    const subject = execFileSync('openssl', ['x509', '-noout', '-subject'], {
      input: pem,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = /OU=([A-Z0-9]{10})\b/.exec(subject);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function setPlistValue(plistPath, key, value) {
  if (!fs.existsSync(plistPath)) {
    return;
  }
  try {
    run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], { capture: true });
  } catch {
    run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plistPath], {
      capture: true,
    });
  }
}

function generateIcons(sharedAppDir, allPlatforms) {
  const macSource = fs.existsSync(MAC_ICON_SOURCE) ? MAC_ICON_SOURCE : FALLBACK_ICON_SOURCE;
  const iosSource = fs.existsSync(IOS_ICON_SOURCE) ? IOS_ICON_SOURCE : macSource;
  const appIconDir = path.join(sharedAppDir, 'Assets.xcassets', 'AppIcon.appiconset');

  if (fs.existsSync(appIconDir)) {
    for (const [filename, size] of MAC_ICON_SIZES) {
      const target = path.join(appIconDir, filename);
      if (fs.existsSync(target)) {
        resizePng(macSource, target, size);
      }
    }
    if (allPlatforms) {
      const iosTarget = path.join(appIconDir, 'universal-icon-1024@1x.png');
      if (fs.existsSync(iosTarget)) {
        resizePng(iosSource, iosTarget, 1024);
      }
    }
  }

  const uiIcon = path.join(sharedAppDir, 'Resources', 'Icon.png');
  if (fs.existsSync(path.dirname(uiIcon))) {
    resizePng(macSource, uiIcon, 256);
  }

  const largeIcon = path.join(
    sharedAppDir,
    'Assets.xcassets',
    'LargeIcon.imageset',
    'icon-128.png',
  );
  if (fs.existsSync(largeIcon)) {
    resizePng(macSource, largeIcon, 128);
  }

  const sourceLabel = macSource === MAC_ICON_SOURCE ? '1024px brand icon' : '128px fallback icon';
  console.log(`Generated AppIcon assets from ${sourceLabel}.`);
}

const MACOS_MIN_VERSION = '14.0';
const IOS_MIN_VERSION = '17.0';

function syncXcodeProjectSettings(marketingVersion) {
  const xcprojPath = path.join(XCODEPROJ, 'project.xcproj');
  if (fs.existsSync(xcprojPath)) {
    const updated = fs
      .readFileSync(xcprojPath, 'utf8')
      .replaceAll(
        /"MARKETING_VERSION"\s*:\s*"[^"]*"/g,
        `"MARKETING_VERSION": "${marketingVersion}"`,
      )
      .replaceAll(
        /"MACOSX_DEPLOYMENT_TARGET"\s*:\s*"[^"]*"/g,
        `"MACOSX_DEPLOYMENT_TARGET": "${MACOS_MIN_VERSION}"`,
      )
      .replaceAll(
        /"IPHONEOS_DEPLOYMENT_TARGET"\s*:\s*"[^"]*"/g,
        `"IPHONEOS_DEPLOYMENT_TARGET": "${IOS_MIN_VERSION}"`,
      );
    fs.writeFileSync(xcprojPath, updated, 'utf8');
  }

  const pbxprojPath = path.join(XCODEPROJ, 'project.pbxproj');
  if (fs.existsSync(pbxprojPath)) {
    const updated = fs
      .readFileSync(pbxprojPath, 'utf8')
      .replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`)
      .replaceAll(
        /MACOSX_DEPLOYMENT_TARGET = [^;]+;/g,
        `MACOSX_DEPLOYMENT_TARGET = ${MACOS_MIN_VERSION};`,
      )
      .replaceAll(
        /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
        `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_MIN_VERSION};`,
      );
    fs.writeFileSync(pbxprojPath, updated, 'utf8');
  }
}

function customizeContainerApp(sharedAppDir, macAppDir) {
  const mainHtml = path.join(sharedAppDir, 'Resources', 'Base.lproj', 'Main.html');
  const styleCss = path.join(sharedAppDir, 'Resources', 'Style.css');
  if (!fs.existsSync(mainHtml)) {
    throw new Error(`Expected Safari container Main.html at ${mainHtml}`);
  }
  fs.writeFileSync(mainHtml, BRANDED_MAIN_HTML, 'utf8');
  fs.writeFileSync(styleCss, BRANDED_STYLE_CSS, 'utf8');

  const macInfoPlist = path.join(macAppDir, 'Info.plist');
  setPlistValue(macInfoPlist, 'LSApplicationCategoryType', 'public.app-category.productivity');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const marketingVersion =
    typeof pkg.version === 'string' && pkg.version !== '0.0.0' ? pkg.version : '1.0';
  syncXcodeProjectSettings(marketingVersion);
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('scripts/build-safari-xcode.mjs requires macOS with Xcode installed.');
  }

  const args = new Set(process.argv.slice(2));
  const allPlatforms = args.has('--all-platforms');
  const noSign = args.has('--no-sign');
  const shouldOpen = args.has('--open');
  const skipBuild = args.has('--skip-build');
  const iosSim = args.has('--ios-sim');
  const skipWxt = args.has('--skip-wxt');

  if (!skipWxt || !fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) {
    run('pnpm', ['build:safari']);
  }

  fs.rmSync(XCODE_OUT_DIR, { recursive: true, force: true });
  const converterArgs = [
    'safari-web-extension-converter',
    EXT_DIR,
    '--project-location',
    XCODE_OUT_DIR,
    '--app-name',
    APP_NAME,
    '--bundle-identifier',
    BUNDLE_ID,
    '--swift',
    '--no-open',
    '--no-prompt',
    '--force',
    '--copy-resources',
    ...(allPlatforms ? [] : ['--macos-only']),
  ];
  const converterOutput = run('xcrun', converterArgs, { capture: true });
  process.stdout.write(converterOutput);
  if (/Warning:/i.test(converterOutput)) {
    throw new Error(`safari-web-extension-converter emitted warnings:\n${converterOutput}`);
  }

  const sharedAppDir = path.join(PROJECT_DIR, allPlatforms ? 'Shared (App)' : APP_NAME);
  const macAppDir = path.join(PROJECT_DIR, allPlatforms ? 'macOS (App)' : APP_NAME);
  generateIcons(sharedAppDir, allPlatforms);
  customizeContainerApp(sharedAppDir, macAppDir);

  if (skipBuild) {
    console.log(`Generated Xcode project at ${XCODEPROJ}`);
    return;
  }

  const teamId = noSign ? null : detectAppleDevelopmentTeam();
  const macScheme = allPlatforms ? `${APP_NAME} (macOS)` : APP_NAME;
  const buildArgs = [
    '-project',
    XCODEPROJ,
    '-scheme',
    macScheme,
    '-configuration',
    'Debug',
    `CONFIGURATION_BUILD_DIR=${BUILD_DIR}`,
    ...(teamId
      ? [
          `DEVELOPMENT_TEAM=${teamId}`,
          'CODE_SIGN_STYLE=Manual',
          'CODE_SIGN_IDENTITY=Apple Development',
        ]
      : ['CODE_SIGNING_ALLOWED=NO']),
    'build',
  ];

  console.log(
    teamId
      ? `Building macOS app (${macScheme}) signed with Apple Development (Team ${teamId})...`
      : `Building macOS app (${macScheme}) unsigned (CODE_SIGNING_ALLOWED=NO)...`,
  );
  run('xcodebuild', buildArgs);

  const builtApp = path.join(BUILD_DIR, `${APP_NAME}.app`);
  if (teamId) {
    run('codesign', ['--verify', '--deep', '--strict', builtApp]);
    console.log(`Verified signature on ${builtApp}`);
  }

  if (allPlatforms && iosSim) {
    console.log(`Building iOS Simulator target (${APP_NAME} (iOS))...`);
    run('xcodebuild', [
      '-project',
      XCODEPROJ,
      '-scheme',
      `${APP_NAME} (iOS)`,
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ]);
  }

  if (shouldOpen) {
    const appex = path.join(builtApp, 'Contents', 'PlugIns', `${APP_NAME} Extension.appex`);
    if (fs.existsSync(appex)) {
      run('pluginkit', ['-a', appex]);
    }
    run('open', [builtApp]);
  }
}

main();
