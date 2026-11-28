import Cocoa
import Foundation
import WebKit

// Native macOS WebKit `WKWebExtension` automated test harness for Feed Sanity.
// Runs `.output/safari-mv3` (or a built `.appex`) inside Apple's actual Safari
// WebExtension engine (`WKWebExtensionController` + `WKWebView` + `NSPopover`)
// and emits a JSON report to stdout.

@available(macOS 15.4, *)
final class MockTab: NSObject, WKWebExtensionTab {
  weak var windowRef: MockWindow?
  let webView: WKWebView
  var isLoadingCompleteFlag = false

  init(webView: WKWebView, window: MockWindow) {
    self.webView = webView
    self.windowRef = window
    super.init()
  }

  func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? {
    windowRef
  }

  func indexInWindow(for context: WKWebExtensionContext) -> Int {
    guard let tabs = windowRef?.tabs else { return NSNotFound }
    return tabs.firstIndex(where: { $0 === self }) ?? NSNotFound
  }

  func webView(for context: WKWebExtensionContext) -> WKWebView? {
    webView
  }

  func title(for context: WKWebExtensionContext) -> String? {
    webView.title
  }

  func url(for context: WKWebExtensionContext) -> URL? {
    webView.url
  }

  func isLoadingComplete(for context: WKWebExtensionContext) -> Bool {
    !webView.isLoading && isLoadingCompleteFlag
  }

  func isSelected(for context: WKWebExtensionContext) -> Bool {
    windowRef?.activeTabRef === self
  }

  func size(for context: WKWebExtensionContext) -> CGSize {
    webView.bounds.size
  }

  func shouldGrantPermissionsOnUserGesture(for context: WKWebExtensionContext) -> Bool {
    true
  }
}

@available(macOS 15.4, *)
final class MockWindow: NSObject, WKWebExtensionWindow {
  let nsWindow: NSWindow
  var tabs: [MockTab] = []
  weak var activeTabRef: MockTab?

  init(frame: NSRect) {
    self.nsWindow = NSWindow(
      contentRect: frame,
      styleMask: [.titled, .closable, .resizable],
      backing: .buffered,
      defer: false
    )
    self.nsWindow.isReleasedWhenClosed = false
    self.nsWindow.orderBack(nil)
    super.init()
  }

  func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] {
    tabs
  }

  func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? {
    activeTabRef
  }

  func windowType(for context: WKWebExtensionContext) -> WKWebExtension.WindowType {
    .normal
  }

  func windowState(for context: WKWebExtensionContext) -> WKWebExtension.WindowState {
    .normal
  }

  func isPrivate(for context: WKWebExtensionContext) -> Bool {
    false
  }

  func frame(for context: WKWebExtensionContext) -> CGRect {
    nsWindow.frame
  }

  func screenFrame(for context: WKWebExtensionContext) -> CGRect {
    nsWindow.screen?.frame ?? NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
  }
}

final class ConsoleCollector: NSObject, WKScriptMessageHandler {
  var entries: [[String: Any]] = []

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    if let dict = message.body as? [String: Any] {
      entries.append(dict)
    } else {
      entries.append(["level": "log", "message": String(describing: message.body)])
    }
  }
}

final class NavDelegate: NSObject, WKNavigationDelegate {
  var onFinish: (() -> Void)?
  var onFail: ((Error) -> Void)?
  var navErrors: [String] = []

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let cb = onFinish
    onFinish = nil
    onFail = nil
    cb?()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    navErrors.append("didFail: \(error.localizedDescription)")
    let cb = onFail
    onFinish = nil
    onFail = nil
    cb?(error)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    navErrors.append("didFailProvisional: \(error.localizedDescription)")
    let cb = onFail
    onFinish = nil
    onFail = nil
    cb?(error)
  }
}

@available(macOS 15.4, *)
final class ExtensionHostDelegate: NSObject, WKWebExtensionControllerDelegate {
  var window: MockWindow
  var presentedActions: [WKWebExtension.Action] = []
  var onPresentPopup: ((WKWebExtension.Action) -> Void)?
  var onActionUpdate: ((WKWebExtension.Action) -> Void)?
  var actionUpdateCount = 0

  init(window: MockWindow) {
    self.window = window
    super.init()
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    openWindowsFor extensionContext: WKWebExtensionContext
  ) -> [any WKWebExtensionWindow] {
    [window]
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    focusedWindowFor extensionContext: WKWebExtensionContext
  ) -> (any WKWebExtensionWindow)? {
    window
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    didUpdate action: WKWebExtension.Action,
    forExtensionContext context: WKWebExtensionContext
  ) {
    actionUpdateCount += 1
    onActionUpdate?(action)
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    presentActionPopup action: WKWebExtension.Action,
    for context: WKWebExtensionContext,
    completionHandler: @escaping (Error?) -> Void
  ) {
    presentedActions.append(action)
    onPresentPopup?(action)
    completionHandler(nil)
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    promptForPermissions permissions: Set<WKWebExtension.Permission>,
    in tab: (any WKWebExtensionTab)?,
    for extensionContext: WKWebExtensionContext,
    completionHandler: @escaping (Set<WKWebExtension.Permission>, Date?) -> Void
  ) {
    completionHandler(permissions, nil)
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
    in tab: (any WKWebExtensionTab)?,
    for extensionContext: WKWebExtensionContext,
    completionHandler: @escaping (Set<WKWebExtension.MatchPattern>, Date?) -> Void
  ) {
    completionHandler(matchPatterns, nil)
  }

  func webExtensionController(
    _ controller: WKWebExtensionController,
    promptForPermissionToAccess urls: Set<URL>,
    in tab: (any WKWebExtensionTab)?,
    for extensionContext: WKWebExtensionContext,
    completionHandler: @escaping (Set<URL>, Date?) -> Void
  ) {
    completionHandler(urls, nil)
  }
}

// Injected at document_start into the page's MAIN world to:
// 1. Capture console errors/warnings, pageerrors, and unhandled rejections.
// 2. Passively observe the real PageBridge handshake (`feed-sanity-page-world-ready`,
//    `feed-sanity-page-world-connect`, `<channel>-connected`) without consuming it.
let PAGE_OBSERVER_JS = """
(() => {
  if (window.__fsObserverInstalled) return;
  window.__fsObserverInstalled = true;
  const send = (level, args) => {
    try {
      const text = args.map((a) => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(' ');
      window.webkit?.messageHandlers?.fsConsole?.postMessage({ level, message: text, href: location.href });
    } catch {}
  };
  for (const level of ['error', 'warn']) {
    const orig = console[level];
    console[level] = function (...args) {
      send(level, args);
      return orig.apply(this, args);
    };
  }
  window.addEventListener('error', (ev) => {
    send('pageerror', [ev.message || String(ev.error), ev.filename || '', ev.lineno || 0]);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    send('unhandledrejection', [ev.reason]);
  });

  // Passively monitor the PageBridge handshake.
  const bridge = {
    readyEvents: 0,
    connectEvents: 0,
    connected: false,
    readers: [],
    toggles: [],
    actions: [],
    mounts: [],
    channelsSeen: [],
  };
  window.__fsBridge = bridge;

  document.addEventListener('feed-sanity-page-world-ready', () => {
    bridge.readyEvents++;
  }, true);

  document.addEventListener('feed-sanity-page-world-connect', (ev) => {
    bridge.connectEvents++;
    try {
      const msg = JSON.parse(ev.detail);
      if (msg && typeof msg.channel === 'string' && !bridge.channelsSeen.includes(msg.channel)) {
        bridge.channelsSeen.push(msg.channel);
        document.addEventListener(msg.channel + '-connected', (cev) => {
          try {
            const info = JSON.parse(cev.detail);
            bridge.connected = true;
            bridge.readers = info.readers || [];
            bridge.toggles = info.toggles || [];
            bridge.actions = info.actions || [];
            bridge.mounts = info.mounts || [];
          } catch {}
        }, true);
      }
    } catch {}
  }, true);
})();
"""

func parseArg(_ flag: String) -> String? {
  let args = CommandLine.arguments
  guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
  return args[idx + 1]
}

@MainActor
func sleepMs(_ ms: UInt64) async {
  try? await Task.sleep(nanoseconds: ms * 1_000_000)
}

@MainActor
func evalJS(_ webView: WKWebView, _ js: String) async -> (Any?, String?) {
  await withCheckedContinuation { cont in
    webView.evaluateJavaScript(js) { result, error in
      cont.resume(returning: (result, error?.localizedDescription))
    }
  }
}

@MainActor
func waitUntil(timeoutMs: Int, intervalMs: UInt64 = 50, check: () async -> Bool) async -> Bool {
  let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
  while Date() < deadline {
    if await check() {
      return true
    }
    await sleepMs(intervalMs)
  }
  return await check()
}

@available(macOS 15.4, *)
@MainActor
func loadSimulated(
  webView: WKWebView,
  nav: NavDelegate,
  tab: MockTab,
  controller: WKWebExtensionController,
  urlString: String,
  html: String
) async throws {
  guard let url = URL(string: urlString) else {
    throw NSError(domain: "Runner", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid URL \(urlString)"])
  }
  tab.isLoadingCompleteFlag = false
  try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
    var resumed = false
    nav.onFinish = {
      guard !resumed else { return }
      resumed = true
      cont.resume()
    }
    nav.onFail = { err in
      guard !resumed else { return }
      resumed = true
      cont.resume(throwing: err)
    }
    webView.loadSimulatedRequest(URLRequest(url: url), responseHTML: html)
  }
  tab.isLoadingCompleteFlag = true
  controller.didChangeTabProperties([.URL, .title, .loading], for: tab)
}

@available(macOS 15.4, *)
@MainActor
func inspectPopup(
  context: WKWebExtensionContext,
  delegate: ExtensionHostDelegate,
  tab: MockTab,
  label: String,
  testThemeInteraction: Bool = false
) async -> [String: Any] {
  var result: [String: Any] = ["label": label]
  let start = Date()
  guard let action = context.action(for: tab) else {
    result["error"] = "context.action(for: tab) returned nil"
    return result
  }
  result["presentsPopup"] = action.presentsPopup
  result["actionLabel"] = action.label
  result["badgeText"] = action.badgeText
  result["isEnabled"] = action.isEnabled

  var presentedByPerformAction = false
  delegate.onPresentPopup = { _ in
    presentedByPerformAction = true
  }
  context.performAction(for: tab)
  _ = await waitUntil(timeoutMs: 2500) { presentedByPerformAction }
  result["presentedByPerformAction"] = presentedByPerformAction

  let popover = action.popupPopover
  guard let popupWebView = action.popupWebView else {
    result["error"] = "action.popupWebView is nil"
    return result
  }

  let rendered = await waitUntil(timeoutMs: 4000, intervalMs: 50) {
    let (val, _) = await evalJS(
      popupWebView,
      "Boolean(document.querySelector('#root') && document.querySelector('#root').childElementCount > 0)"
    )
    return (val as? Bool) == true
  }
  result["renderedWithin4s"] = rendered
  result["elapsedMs"] = Int(Date().timeIntervalSince(start) * 1000)

  // Allow layout / popover sizing to settle.
  await sleepMs(150)

  let inspectJS = """
  (() => {
    const root = document.querySelector('#root');
    const qpRoot = document.querySelector('.qp-root');
    const htmlRect = document.documentElement.getBoundingClientRect();
    const bodyRect = document.body ? document.body.getBoundingClientRect() : null;
    const rootRect = root ? root.getBoundingClientRect() : null;
    const qpRect = qpRoot ? qpRoot.getBoundingClientRect() : null;
    return {
      href: location.href,
      readyState: document.readyState,
      rootChildren: root ? root.childElementCount : -1,
      bodyText: (document.body?.innerText || '').trim().slice(0, 600),
      htmlSize: { w: Math.round(htmlRect.width), h: Math.round(htmlRect.height) },
      bodySize: bodyRect ? { w: Math.round(bodyRect.width), h: Math.round(bodyRect.height) } : null,
      rootSize: rootRect ? { w: Math.round(rootRect.width), h: Math.round(rootRect.height) } : null,
      qpRootSize: qpRect ? { w: Math.round(qpRect.width), h: Math.round(qpRect.height) } : null,
      scrollSize: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  })()
  """
  let (domInfo, domErr) = await evalJS(popupWebView, inspectJS)
  if let domInfo = domInfo {
    result["dom"] = domInfo
  }
  if let domErr = domErr {
    result["evalError"] = domErr
  }

  if testThemeInteraction {
    // Click the second theme swatch (first preset after Site Default) and verify
    // it propagates through browser.storage.local into the live Facebook tab,
    // then reset back to Site Default (first swatch).
    let (clickedPreset, _) = await evalJS(
      popupWebView,
      """
      (() => {
        const swatches = document.querySelectorAll('.qp-swatch-btn');
        if (swatches.length < 2) return false;
        swatches[1].click();
        return true;
      })()
      """
    )
    let themeApplied = await waitUntil(timeoutMs: 3000, intervalMs: 50) {
      let (len, _) = await evalJS(
        tab.webView,
        "(document.querySelector('#feed_sanity_user_theme')?.textContent || '').length"
      )
      return ((len as? Int) ?? 0) > 100
    }
    let (themeCssLen, _) = await evalJS(
      tab.webView,
      "(document.querySelector('#feed_sanity_user_theme')?.textContent || '').length"
    )
    _ = await evalJS(
      popupWebView,
      """
      (() => {
        const swatches = document.querySelectorAll('.qp-swatch-btn');
        if (swatches.length > 0) swatches[0].click();
      })()
      """
    )
    let themeCleared = await waitUntil(timeoutMs: 3000, intervalMs: 50) {
      let (present, _) = await evalJS(
        tab.webView,
        "Boolean(document.querySelector('#feed_sanity_user_theme'))"
      )
      return (present as? Bool) == false
    }
    result["interaction"] = [
      "clickedPreset": (clickedPreset as? Bool) ?? false,
      "themeAppliedOnTab": themeApplied,
      "themeCssLength": (themeCssLen as? Int) ?? 0,
      "themeClearedOnTab": themeCleared,
    ]
  }

  if let popover = popover {
    result["popoverSize"] = [
      "w": Int(popover.contentSize.width),
      "h": Int(popover.contentSize.height),
    ]
  }
  action.closePopup()
  result["contextErrors"] = context.errors.map { $0.localizedDescription }
  return result
}

func readFixture(_ base: String, _ rel: String) -> String {
  let full = (base as NSString).appendingPathComponent(rel)
  return (try? String(contentsOfFile: full, encoding: .utf8)) ?? ""
}

func buildFacebookStressHTML(baseHTML: String, extraStyleRules: Int, extraPosts: Int) -> String {
  // Simulate Facebook's massive atomic CSS bundles (multiple sheets + collisions).
  var sheets: [String] = []
  let perSheet = max(1, extraStyleRules / 4)
  for s in 0..<4 {
    var cssLines: [String] = []
    cssLines.reserveCapacity(perSheet + 10)
    for i in 0..<perSheet {
      let cls = String(format: "x%02x%04x", s + 1, i + 1)
      cssLines.append(".\(cls){padding-top:\(i % 16)px}")
    }
    // Add colliding single-declaration classes, as Facebook's atomic bundles have.
    let p = s + 1
    cssLines.append(".x\(p)posrel{position:relative}")
    cssLines.append(".x\(p)disflx{display:flex}")
    cssLines.append(".x\(p)fldcol{flex-direction:column}")
    cssLines.append(".x\(p)outnon{outline-style:none}")
    cssLines.append(".x\(p)visvis{visibility:visible}")
    sheets.append("<style id=\"fb-atomic-sheet-\(s)\">\n" + cssLines.joined(separator: "\n") + "\n</style>")
  }

  var posts: [String] = []
  posts.reserveCapacity(extraPosts)
  for i in 10..<(10 + extraPosts) {
    let isSponsored = (i % 5 == 0)
    let isSuggested = (i % 4 == 0)
    let followBtn = isSuggested ? "<div role=\"button\">Follow</div>" : ""
    let bodyText = isSponsored ? "Sponsored product promo \(i)" : "Regular friend update number \(i) with some text about coffee and cats."
    let videoTag = (i % 6 == 0) ? "<div data-video-id=\"vid\(i)\"><video width=\"400\" height=\"225\"></video><a href=\"/reel/\(i)/\" style=\"display:block;width:400px;height:225px\"></a></div>" : ""
    posts.append("""
    <div aria-posinset="\(i)" aria-setsize="-1" role="article">
      <div data-ad-rendering-role="profile_name" style="display:flex;flex-direction:row">
        <h4><strong>Author \(i)</strong>\(followBtn)</h4>
        <span><a role="link" aria-labelledby="l\(i)" aria-describedby="d\(i)" href="/posts/100000\(i)/">2h</a></span>
        <div role="button" aria-haspopup="menu" aria-label="Actions for this post">...</div>
      </div>
      <div data-ad-rendering-role="story_message">\(bodyText)</div>
      \(videoTag)
      <div class="x1posrel x1disflx x1fldcol"><span>Like</span><span>Comment</span><span>Share</span></div>
    </div>
    """)
  }

  var html = baseHTML
  if let range = html.range(of: "</head>") {
    html.replaceSubrange(range, with: sheets.joined(separator: "\n") + "\n</head>")
  }
  if let feedEnd = html.range(of: "</div>\n      </div>\n    </div>") {
    html.replaceSubrange(feedEnd, with: posts.joined(separator: "\n") + "\n</div>\n      </div>\n    </div>")
  } else if let bodyEnd = html.range(of: "</body>") {
    html.replaceSubrange(bodyEnd, with: "<div role=\"feed\">" + posts.joined(separator: "\n") + "</div>\n</body>")
  }
  return html
}

@available(macOS 15.4, *)
@MainActor
func runSuite(extensionPath: String, fixturesDir: String) async -> [String: Any] {
  var report: [String: Any] = [
    "extensionPath": extensionPath,
    "macOSVersion": ProcessInfo.processInfo.operatingSystemVersionString,
  ]

  let absExtPath = URL(fileURLWithPath: extensionPath).standardizedFileURL.path
  let extURL = URL(fileURLWithPath: absExtPath, isDirectory: true)
  let webExt: WKWebExtension
  do {
    if absExtPath.hasSuffix(".appex"), let bundle = Bundle(url: extURL) {
      webExt = try await WKWebExtension(appExtensionBundle: bundle)
    } else {
      webExt = try await WKWebExtension(resourceBaseURL: extURL)
    }
  } catch {
    report["fatalError"] = "Failed to load WKWebExtension: \(error.localizedDescription)"
    return report
  }

  report["extensionLoad"] = [
    "displayName": webExt.displayName ?? "",
    "version": webExt.version ?? "",
    "manifestVersion": webExt.manifestVersion,
    "hasBackgroundContent": webExt.hasBackgroundContent,
    "hasInjectedContent": webExt.hasInjectedContent,
    "parseErrors": webExt.errors.map { $0.localizedDescription },
    "requestedPermissions": webExt.requestedPermissions.map { $0.rawValue }.sorted(),
    "requestedMatchPatterns": webExt.allRequestedMatchPatterns.map { $0.string }.sorted(),
  ]

  let context = WKWebExtensionContext(for: webExt)
  context.isInspectable = true
  for perm in webExt.requestedPermissions {
    context.setPermissionStatus(.grantedExplicitly, for: perm)
  }
  for pattern in webExt.allRequestedMatchPatterns {
    context.setPermissionStatus(.grantedExplicitly, for: pattern)
  }

  let controllerConfig = WKWebExtensionController.Configuration.nonPersistent()
  let controller = WKWebExtensionController(configuration: controllerConfig)

  let mockWindow = MockWindow(frame: NSRect(x: 40, y: 40, width: 1280, height: 900))
  let delegate = ExtensionHostDelegate(window: mockWindow)
  controller.delegate = delegate

  do {
    try controller.load(context)
  } catch {
    report["fatalError"] = "controller.load failed: \(error.localizedDescription)"
    return report
  }

  do {
    try await context.loadBackgroundContent()
  } catch {
    report["backgroundLoadError"] = error.localizedDescription
  }
  await sleepMs(400)
  report["afterBackgroundErrors"] = context.errors.map { $0.localizedDescription }

  let webViewConfig = WKWebViewConfiguration()
  webViewConfig.webExtensionController = controller
  let consoleCollector = ConsoleCollector()
  webViewConfig.userContentController.add(consoleCollector, name: "fsConsole")
  webViewConfig.userContentController.addUserScript(
    WKUserScript(source: PAGE_OBSERVER_JS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
  )

  let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 900), configuration: webViewConfig)
  webView.isInspectable = true
  mockWindow.nsWindow.contentView = webView

  let nav = NavDelegate()
  webView.navigationDelegate = nav

  let tab = MockTab(webView: webView, window: mockWindow)
  mockWindow.tabs = [tab]
  mockWindow.activeTabRef = tab

  controller.didOpenWindow(mockWindow)
  controller.didFocusWindow(mockWindow)
  controller.didOpenTab(tab)
  controller.didActivateTab(tab, previousActiveTab: nil)

  // 1) Popup on unsupported page (https://example.com/)
  do {
    try await loadSimulated(
      webView: webView,
      nav: nav,
      tab: tab,
      controller: controller,
      urlString: "https://example.com/",
      html: "<!doctype html><html><head><title>Example</title></head><body><h1>Example</h1></body></html>"
    )
    await sleepMs(200)
    report["popupUnsupported"] = await inspectPopup(
      context: context,
      delegate: delegate,
      tab: tab,
      label: "unsupported"
    )
  } catch {
    report["popupUnsupported"] = ["error": error.localizedDescription]
  }

  // 2) Facebook fixture + MAIN-world bridge + Popup on Facebook
  let fbHTML = readFixture(fixturesDir, "index.html")
  let reactDataJS = readFixture(fixturesDir, "react-data.js")
  let fbWithReact = fbHTML.replacingOccurrences(
    of: "<script src=\"/react-data.js\"></script>",
    with: "<script>\(reactDataJS)</script>"
  )
  consoleCollector.entries.removeAll()
  let actionUpdatesBeforeFb = delegate.actionUpdateCount
  do {
    try await loadSimulated(
      webView: webView,
      nav: nav,
      tab: tab,
      controller: controller,
      urlString: "https://www.facebook.com/",
      html: fbWithReact
    )
    let postsTracked = await waitUntil(timeoutMs: 5000) {
      let (val, _) = await evalJS(webView, "document.querySelectorAll('[data-feed-sanity-post]').length")
      return ((val as? Int) ?? 0) > 0
    }
    await sleepMs(800)

    let (fbState, fbErr) = await evalJS(webView, """
    (() => {
      return {
        posts: document.querySelectorAll('[data-feed-sanity-post]').length,
        withId: document.querySelectorAll('[data-feed-sanity-post-id]:not([data-feed-sanity-post-id="none"])').length,
        hasOwnUi: document.querySelectorAll('[data-feed-sanity]').length > 0,
        bridge: window.__fsBridge || null,
        htmlAttrs: Array.from(document.documentElement.attributes).map((a) => a.name),
      };
    })()
    """)
    var fbResult: [String: Any] = [
      "postsTracked": postsTracked,
      "state": fbState ?? NSNull(),
      "actionUpdates": delegate.actionUpdateCount - actionUpdatesBeforeFb,
      "console": consoleCollector.entries,
    ]
    if let fbErr = fbErr { fbResult["evalError"] = fbErr }
    report["facebook"] = fbResult

    report["popupFacebook"] = await inspectPopup(
      context: context,
      delegate: delegate,
      tab: tab,
      label: "facebook",
      testThemeInteraction: true
    )
  } catch {
    report["facebook"] = ["error": error.localizedDescription]
  }

  // 3) Facebook stress / responsiveness test (20,000 CSS rules + 60 posts + videos + rapid DOM mutations)
  consoleCollector.entries.removeAll()
  let stressHTML = buildFacebookStressHTML(baseHTML: fbWithReact, extraStyleRules: 20_000, extraPosts: 60)
  do {
    let loadStart = Date()
    try await loadSimulated(
      webView: webView,
      nav: nav,
      tab: tab,
      controller: controller,
      urlString: "https://www.facebook.com/?sk=h_nor",
      html: stressHTML
    )
    let loadMs = Int(Date().timeIntervalSince(loadStart) * 1000)

    // Measure REAL unthrottled main-thread blocking time using MessageChannel
    // (never throttled to 1 Hz like offscreen setInterval/rAF in macOS WebKit)
    // across 16 realistic DOM mutation bursts + SPA URL change.
    _ = await evalJS(webView, """
    (() => {
      window.__perf = {
        maxBatchBlockMs: 0,
        totalBatchBlockMs: 0,
        batchTimings: [],
        mutationBatches: 0,
        done: false,
      };
      let count = 200;
      const feed = document.querySelector('[role="feed"]') || document.body;
      const mc = new MessageChannel();

      const runNextBatch = () => {
        const t0 = performance.now();
        // Simulate Facebook adding newly scrolled posts + noisy leaf reactions.
        for (let k = 0; k < 4; k++) {
          count++;
          const div = document.createElement('div');
          div.setAttribute('aria-posinset', String(count));
          div.setAttribute('role', 'article');
          const header = document.createElement('div');
          header.setAttribute('data-ad-rendering-role', 'profile_name');
          header.style.cssText = 'display:flex;flex-direction:row';
          const h4 = document.createElement('h4');
          const strong = document.createElement('strong');
          strong.textContent = 'Dynamic Author ' + count;
          h4.appendChild(strong);
          const a = document.createElement('a');
          a.setAttribute('role', 'link');
          a.setAttribute('aria-labelledby', 'dl' + count);
          a.setAttribute('aria-describedby', 'dd' + count);
          a.href = '/posts/900000' + count + '/';
          a.textContent = '1m';
          const menu = document.createElement('div');
          menu.setAttribute('role', 'button');
          menu.setAttribute('aria-haspopup', 'menu');
          menu.textContent = '...';
          header.append(h4, a, menu);
          const msg = document.createElement('div');
          msg.setAttribute('data-ad-rendering-role', 'story_message');
          msg.textContent = 'Fresh dynamic feed item #' + count;
          div.append(header, msg);
          feed.appendChild(div);
        }
        const firstPost = document.querySelector('[data-feed-sanity-post]');
        if (firstPost) {
          for (let n = 0; n < 20; n++) {
            const span = document.createElement('span');
            span.textContent = 'reaction ' + n;
            firstPost.appendChild(span);
          }
        }
        window.__perf.mutationBatches++;
        if (window.__perf.mutationBatches === 8) {
          history.pushState({}, '', '/?sk=h_chr');
        }
        // Measure how long the browser main thread stays blocked (including
        // MutationObserver microtasks and layout) before the next macrotask runs.
        mc.port1.onmessage = () => {
          const dt = Math.round(performance.now() - t0);
          window.__perf.batchTimings.push(dt);
          window.__perf.totalBatchBlockMs += dt;
          if (dt > window.__perf.maxBatchBlockMs) window.__perf.maxBatchBlockMs = dt;
          if (window.__perf.mutationBatches >= 16) {
            window.__perf.done = true;
          } else {
            runNextBatch();
          }
        };
        mc.port2.postMessage(0);
      };

      // Let initial load + post scan settle briefly, then run the 16 mutation batches.
      mc.port1.onmessage = () => runNextBatch();
      mc.port2.postMessage(0);
    })()
    """)

    _ = await waitUntil(timeoutMs: 10_000, intervalMs: 100) {
      let (done, _) = await evalJS(webView, "Boolean(window.__perf && window.__perf.done)")
      return (done as? Bool) == true
    }
    let (perfVal, perfErr) = await evalJS(webView, """
    (() => ({
      ...window.__perf,
      trackedPosts: document.querySelectorAll('[data-feed-sanity-post]').length,
      identifiedPosts: document.querySelectorAll('[data-feed-sanity-post-id]').length,
      markReadButtons: document.querySelectorAll('.feed-sanity-mark-read').length,
    }))()
    """)
    var perfResult: [String: Any] = [
      "loadMs": loadMs,
      "metrics": perfVal ?? NSNull(),
      "consoleErrors": consoleCollector.entries,
    ]
    if let perfErr = perfErr { perfResult["evalError"] = perfErr }
    report["facebookPerf"] = perfResult
  } catch {
    report["facebookPerf"] = ["error": error.localizedDescription]
  }

  // 4) Other sites (X, Instagram, Reddit, Gmail)
  let siteChecks: [(String, String, String, Bool)] = [
    ("x", "https://x.com/home", "x/home.html", true),
    ("instagram", "https://www.instagram.com/", "instagram/index.html", true),
    ("reddit", "https://www.reddit.com/", "reddit/index.html", true),
    ("gmail", "https://mail.google.com/mail/u/0/#inbox", "gmail/index.html", false),
  ]
  var siteResults: [String: Any] = [:]
  for (siteId, urlStr, relFixture, expectsBridge) in siteChecks {
    consoleCollector.entries.removeAll()
    let html = readFixture(fixturesDir, relFixture)
    do {
      try await loadSimulated(
        webView: webView,
        nav: nav,
        tab: tab,
        controller: controller,
        urlString: urlStr,
        html: html
      )
      await sleepMs(700)
      let (probe, probeErr) = await evalJS(webView, """
      (() => ({
        href: location.href,
        ownElements: document.querySelectorAll('[data-feed-sanity]').length,
        bridge: window.__fsBridge || null,
      }))()
      """)
      var entry: [String: Any] = [
        "expectsBridge": expectsBridge,
        "probe": probe ?? NSNull(),
        "consoleErrors": consoleCollector.entries,
      ]
      if let probeErr = probeErr { entry["evalError"] = probeErr }
      siteResults[siteId] = entry
    } catch {
      siteResults[siteId] = ["error": error.localizedDescription]
    }
  }
  report["sites"] = siteResults

  // 5) Excluded Facebook static host check
  do {
    try await loadSimulated(
      webView: webView,
      nav: nav,
      tab: tab,
      controller: controller,
      urlString: "https://static.xx.facebook.com/rsrc.php/test.html",
      html: "<!doctype html><html><body><div aria-posinset=\"1\" role=\"article\"><h4><strong>Static</strong></h4></div></body></html>"
    )
    await sleepMs(400)
    let (exclVal, _) = await evalJS(webView, """
    (() => ({
      postsTracked: document.querySelectorAll('[data-feed-sanity-post]').length,
      bridge: window.__fsBridge || null,
    }))()
    """)
    report["facebookStaticExcluded"] = exclVal ?? NSNull()
  } catch {
    report["facebookStaticExcluded"] = ["error": error.localizedDescription]
  }

  report["finalContextErrors"] = context.errors.map { $0.localizedDescription }

  // 6) Pre-existing open tab auto-attach + live extension reload/upgrade (NO tab refresh!)
  do {
    let autoConfig = WKWebExtensionController.Configuration.nonPersistent()
    let autoController = WKWebExtensionController(configuration: autoConfig)
    let autoWindow = MockWindow(frame: NSRect(x: 60, y: 60, width: 1280, height: 900))
    let autoDelegate = ExtensionHostDelegate(window: autoWindow)
    autoController.delegate = autoDelegate

    let autoWvConfig = WKWebViewConfiguration()
    autoWvConfig.webExtensionController = autoController
    let autoConsole = ConsoleCollector()
    autoWvConfig.userContentController.add(autoConsole, name: "fsConsole")
    autoWvConfig.userContentController.addUserScript(
      WKUserScript(source: PAGE_OBSERVER_JS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    )

    let autoWebView = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 1280, height: 900),
      configuration: autoWvConfig
    )
    autoWindow.nsWindow.contentView = autoWebView
    let autoNav = NavDelegate()
    autoWebView.navigationDelegate = autoNav
    let autoTab = MockTab(webView: autoWebView, window: autoWindow)
    autoWindow.tabs = [autoTab]
    autoWindow.activeTabRef = autoTab

    autoController.didOpenWindow(autoWindow)
    autoController.didFocusWindow(autoWindow)
    autoController.didOpenTab(autoTab)
    autoController.didActivateTab(autoTab, previousActiveTab: nil)

    // Load Facebook BEFORE the extension is loaded into the controller.
    try await loadSimulated(
      webView: autoWebView,
      nav: autoNav,
      tab: autoTab,
      controller: autoController,
      urlString: "https://www.facebook.com/",
      html: fbWithReact
    )
    await sleepMs(150)
    let (beforeVal, _) = await evalJS(autoWebView, """
    (() => ({
      posts: document.querySelectorAll('[data-feed-sanity-post]').length,
      markRead: document.querySelectorAll('.feed-sanity-mark-read').length,
    }))()
    """)

    func makeGrantedContext() -> WKWebExtensionContext {
      let ctx = WKWebExtensionContext(for: webExt)
      ctx.isInspectable = true
      for perm in webExt.requestedPermissions {
        ctx.setPermissionStatus(.grantedExplicitly, for: perm)
      }
      for pattern in webExt.allRequestedMatchPatterns {
        ctx.setPermissionStatus(.grantedExplicitly, for: pattern)
      }
      return ctx
    }

    // Install extension while the Facebook tab is already open (no tab refresh).
    let ctxA = makeGrantedContext()
    try autoController.load(ctxA)
    try await ctxA.loadBackgroundContent()

    let attachedInitial = await waitUntil(timeoutMs: 5000, intervalMs: 50) {
      let (ready, _) = await evalJS(
        autoWebView,
        """
        (() => {
          const posts = document.querySelectorAll('[data-feed-sanity-post]').length;
          const identified = document.querySelectorAll('[data-feed-sanity-post-id]').length;
          const buttons = document.querySelectorAll('.feed-sanity-mark-read').length;
          return posts >= 5 && identified === posts && buttons === posts && Boolean(window.__fsBridge && window.__fsBridge.connected);
        })()
        """
      )
      return (ready as? Bool) == true
    }
    await sleepMs(250)
    let (afterInstallVal, _) = await evalJS(autoWebView, """
    (() => ({
      posts: document.querySelectorAll('[data-feed-sanity-post]').length,
      withId: document.querySelectorAll('[data-feed-sanity-post-id]:not([data-feed-sanity-post-id="none"])').length,
      markRead: document.querySelectorAll('.feed-sanity-mark-read').length,
      channelsSeen: (window.__fsBridge?.channelsSeen || []).length,
      connected: Boolean(window.__fsBridge?.connected),
    }))()
    """)
    let popupAfterInstall = await inspectPopup(
      context: ctxA,
      delegate: autoDelegate,
      tab: autoTab,
      label: "auto-attach-install"
    )

    // Simulate extension reload/upgrade on the SAME open tab (still no tab refresh).
    // Reset `connected` before unloading ctxA so we prove ctxB establishes its own live bridge.
    _ = await evalJS(autoWebView, "if (window.__fsBridge) window.__fsBridge.connected = false;")
    try autoController.unload(ctxA)
    await sleepMs(150)
    let ctxB = makeGrantedContext()
    try autoController.load(ctxB)
    try await ctxB.loadBackgroundContent()

    let upgradedLive = await waitUntil(timeoutMs: 5000, intervalMs: 50) {
      let (ready, _) = await evalJS(
        autoWebView,
        """
        (() => {
          const posts = document.querySelectorAll('[data-feed-sanity-post]').length;
          const identified = document.querySelectorAll('[data-feed-sanity-post-id]').length;
          const buttons = document.querySelectorAll('.feed-sanity-mark-read').length;
          return (window.__fsBridge?.channelsSeen || []).length >= 2 && posts >= 5 && identified === posts && buttons === posts && Boolean(window.__fsBridge?.connected);
        })()
        """
      )
      return (ready as? Bool) == true
    }
    await sleepMs(250)
    let (afterUpgradeVal, _) = await evalJS(autoWebView, """
    (() => ({
      posts: document.querySelectorAll('[data-feed-sanity-post]').length,
      withId: document.querySelectorAll('[data-feed-sanity-post-id]:not([data-feed-sanity-post-id="none"])').length,
      markRead: document.querySelectorAll('.feed-sanity-mark-read').length,
      channelsSeen: (window.__fsBridge?.channelsSeen || []).length,
      connected: Boolean(window.__fsBridge?.connected),
    }))()
    """)
    let popupAfterUpgrade = await inspectPopup(
      context: ctxB,
      delegate: autoDelegate,
      tab: autoTab,
      label: "auto-attach-upgrade"
    )

    report["autoAttach"] = [
      "beforeInstall": beforeVal ?? NSNull(),
      "attachedInitial": attachedInitial,
      "afterInstall": afterInstallVal ?? NSNull(),
      "popupAfterInstall": popupAfterInstall,
      "upgradedLive": upgradedLive,
      "afterUpgrade": afterUpgradeVal ?? NSNull(),
      "popupAfterUpgrade": popupAfterUpgrade,
      "consoleErrors": autoConsole.entries,
      "contextAErrors": ctxA.errors.map { $0.localizedDescription },
      "contextBErrors": ctxB.errors.map { $0.localizedDescription },
    ]
  } catch {
    report["autoAttach"] = ["error": error.localizedDescription]
  }

  return report
}

@available(macOS 15.4, *)
final class RunnerAppDelegate: NSObject, NSApplicationDelegate {
  let extPath: String
  let fixturesDir: String

  init(extPath: String, fixturesDir: String) {
    self.extPath = extPath
    self.fixturesDir = fixturesDir
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    Task { @MainActor in
      let report = await runSuite(extensionPath: self.extPath, fixturesDir: self.fixturesDir)
      if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
         let str = String(data: data, encoding: .utf8) {
        print(str)
      } else {
        fputs("Failed to serialize JSON report\n", stderr)
        exit(1)
      }
      exit(0)
    }
  }
}

guard let extPath = parseArg("--extension"), let fixturesDir = parseArg("--fixtures") else {
  fputs("Usage: safari-wkwebextension-runner --extension <dir|.appex> --fixtures <e2e/pages>\n", stderr)
  exit(2)
}

if #available(macOS 15.4, *) {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let appDelegate = RunnerAppDelegate(extPath: extPath, fixturesDir: fixturesDir)
  app.delegate = appDelegate
  app.run()
} else {
  fputs("Requires macOS 15.4+ for WKWebExtension.\n", stderr)
  exit(3)
}
