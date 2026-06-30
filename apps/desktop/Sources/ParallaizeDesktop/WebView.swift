import SwiftUI
import WebKit

struct DesktopWebView: NSViewRepresentable {
    let url: URL
    let avoidTrafficLights: Bool
    let onConnectionFailure: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(avoidTrafficLights: avoidTrafficLights, onConnectionFailure: onConnectionFailure)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let preferences = WKPreferences()
        preferences.javaScriptCanOpenWindowsAutomatically = true

        if #available(macOS 12.3, *) {
            preferences.isElementFullscreenEnabled = false
        }

        configuration.preferences = preferences
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "ParallaizeDesktop"
        configuration.userContentController = context.coordinator.makeUserContentController()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        DispatchQueue.main.async {
            context.coordinator.attach(webView)
            context.coordinator.setTrafficLightInset(avoidTrafficLights)
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if webView.url?.absoluteString != url.absoluteString {
            webView.load(URLRequest(url: url))
        }
        context.coordinator.attach(webView)
        context.coordinator.setTrafficLightInset(avoidTrafficLights)
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.detach()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.fullscreenMessageName)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        static let fullscreenMessageName = "parallaizeFullscreen"

        private let onConnectionFailure: (String) -> Void
        private weak var webView: WKWebView?
        private weak var window: NSWindow?
        private var avoidTrafficLights: Bool
        private var fullscreenObservers: [NSObjectProtocol] = []

        init(avoidTrafficLights: Bool, onConnectionFailure: @escaping (String) -> Void) {
            self.avoidTrafficLights = avoidTrafficLights
            self.onConnectionFailure = onConnectionFailure
        }

        func makeUserContentController() -> WKUserContentController {
            let controller = WKUserContentController()
            controller.add(self, name: Self.fullscreenMessageName)
            controller.addUserScript(
                WKUserScript(
                    source: Self.fullscreenShimScript,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: false
                )
            )
            controller.addUserScript(
                WKUserScript(
                    source: Self.desktopChromeInsetScript,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: false
                )
            )
            return controller
        }

        func attach(_ webView: WKWebView) {
            self.webView = webView

            guard window !== webView.window else {
                syncFullscreenState()
                return
            }

            detach()
            self.webView = webView
            self.window = webView.window

            guard let window = webView.window else {
                return
            }

            let center = NotificationCenter.default
            fullscreenObservers = [
                center.addObserver(
                    forName: NSWindow.didEnterFullScreenNotification,
                    object: window,
                    queue: .main
                ) { [weak self] _ in
                    self?.setWebFullscreen(active: true)
                },
                center.addObserver(
                    forName: NSWindow.didExitFullScreenNotification,
                    object: window,
                    queue: .main
                ) { [weak self] _ in
                    self?.setWebFullscreen(active: false)
                },
            ]
            syncFullscreenState()
        }

        func detach() {
            for observer in fullscreenObservers {
                NotificationCenter.default.removeObserver(observer)
            }
            fullscreenObservers = []
            window = nil
        }

        deinit {
            detach()
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }

            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            attach(webView)
            setTrafficLightInset(avoidTrafficLights)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            handleNavigationFailure(error)
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            handleNavigationFailure(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            onConnectionFailure("The web content process terminated.")
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard
                message.name == Self.fullscreenMessageName,
                let body = message.body as? [String: Any],
                let action = body["action"] as? String
            else {
                return
            }

            switch action {
            case "request":
                setNativeFullscreen(active: true)
            case "exit":
                setNativeFullscreen(active: false)
            default:
                break
            }
        }

        private func setNativeFullscreen(active: Bool) {
            guard let window = webView?.window ?? window else {
                setWebFullscreen(active: false)
                return
            }

            let current = window.styleMask.contains(.fullScreen)
            guard current != active else {
                setWebFullscreen(active: active)
                return
            }

            window.toggleFullScreen(nil)
        }

        private func syncFullscreenState() {
            setWebFullscreen(active: window?.styleMask.contains(.fullScreen) == true)
        }

        private func setWebFullscreen(active: Bool) {
            let value = active ? "true" : "false"
            webView?.evaluateJavaScript(
                "window.__parallaizeDesktopSetFullscreen && window.__parallaizeDesktopSetFullscreen(\(value));",
                completionHandler: nil
            )
        }

        func setTrafficLightInset(_ enabled: Bool) {
            avoidTrafficLights = enabled
            let value = enabled ? "true" : "false"
            webView?.evaluateJavaScript(
                "window.__parallaizeDesktopSetTrafficLightInset && window.__parallaizeDesktopSetTrafficLightInset(\(value));",
                completionHandler: nil
            )
        }

        private func handleNavigationFailure(_ error: Error) {
            let nsError = error as NSError

            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                return
            }

            onConnectionFailure(error.localizedDescription)
        }

        private static let fullscreenShimScript = #"""
(() => {
  if (window.__parallaizeDesktopFullscreenShimInstalled) {
    return;
  }

  window.__parallaizeDesktopFullscreenShimInstalled = true;
  let active = false;

  const post = (action) => {
    try {
      window.webkit.messageHandlers.parallaizeFullscreen.postMessage({ action });
    } catch (_) {}
  };

  const define = (target, property, descriptor) => {
    try {
      Object.defineProperty(target, property, { configurable: true, ...descriptor });
    } catch (_) {}
  };

  const dispatchChange = () => {
    document.dispatchEvent(new Event("fullscreenchange"));
    document.dispatchEvent(new Event("webkitfullscreenchange"));
  };

  window.__parallaizeDesktopSetFullscreen = (nextActive) => {
    const normalized = Boolean(nextActive);
    if (active === normalized) {
      return;
    }

    active = normalized;
    dispatchChange();
  };

  define(Document.prototype, "fullscreenElement", {
    get: () => active ? document.documentElement : null,
  });
  define(Document.prototype, "webkitFullscreenElement", {
    get: () => active ? document.documentElement : null,
  });
  define(Document.prototype, "fullscreenEnabled", {
    get: () => true,
  });
  define(Document.prototype, "webkitFullscreenEnabled", {
    get: () => true,
  });

  Document.prototype.exitFullscreen = function () {
    post("exit");
    return Promise.resolve();
  };
  Document.prototype.webkitExitFullscreen = function () {
    post("exit");
  };
  document.exitFullscreen = Document.prototype.exitFullscreen.bind(document);
  document.webkitExitFullscreen = Document.prototype.webkitExitFullscreen.bind(document);

  Element.prototype.requestFullscreen = function () {
    post("request");
    return Promise.resolve();
  };
  Element.prototype.webkitRequestFullscreen = function () {
    post("request");
  };
})();
"""#

        private static let desktopChromeInsetScript = #"""
(() => {
  if (window.__parallaizeDesktopChromeInsetInstalled) {
    return;
  }

  window.__parallaizeDesktopChromeInsetInstalled = true;

  const installStyle = () => {
    if (document.getElementById("parallaize-desktop-chrome-inset-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "parallaize-desktop-chrome-inset-style";
    style.textContent = `
      html.parallaize-desktop-traffic-light-inset .workspace-rail:not(.workspace-rail--compact) .workspace-rail__header {
        padding-left: max(1rem, 116px);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  window.__parallaizeDesktopSetTrafficLightInset = (enabled) => {
    installStyle();
    document.documentElement.classList.toggle(
      "parallaize-desktop-traffic-light-inset",
      Boolean(enabled),
    );
  };

  installStyle();
})();
"""#
    }
}
