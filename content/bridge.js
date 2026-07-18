/**
 * Isolated-world bridge: MAIN attractor UI → extension.
 * Also polls for exit attribute as a backup if postMessage is flaky.
 */
(function () {
  if (window.__viewProxyBridgeV2) return;
  window.__viewProxyBridgeV2 = true;

  function exitFocus() {
    chrome.runtime.sendMessage({ type: "stop-focus-mode" }).catch(() => {});
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "viewproxy") return;
    if (data.type === "exit-focus") exitFocus();
    if (data.type === "crop-resize-toggle") {
      chrome.runtime
        .sendMessage({ type: "crop-resize-toggle", enabled: !!data.enabled })
        .catch(() => {});
    }
    if (data.type === "request-refill") {
      chrome.runtime.sendMessage({ type: "attract-refill" }).catch(() => {});
    }
  });

  // Backup: MAIN sets data-viewproxy-exit on click
  const mo = new MutationObserver(() => {
    const stamp = document.documentElement.getAttribute("data-viewproxy-exit");
    if (stamp) {
      document.documentElement.removeAttribute("data-viewproxy-exit");
      exitFocus();
    }
  });
  try {
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-viewproxy-exit"]
    });
  } catch (_) {}
})();
