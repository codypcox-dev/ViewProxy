/**
 * Isolated-world bridge: MAIN attractor UI → extension.
 * Also keeps Attract centered: true client viewport lives here (MAIN freezes metrics).
 */
(function () {
  if (window.__viewProxyBridgeV3) return;
  window.__viewProxyBridgeV3 = true;

  function exitFocus() {
    chrome.runtime.sendMessage({ type: "stop-focus-mode" }).catch(() => {});
  }

  function requestRefill() {
    chrome.runtime.sendMessage({ type: "attract-refill" }).catch(() => {});
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
    if (data.type === "request-refill") requestRefill();
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

  // Continuous re-center whenever the real client size changes.
  // Debounced so drag-resize doesn't flood the service worker.
  let refillTimer = null;
  let lastIW = 0;
  let lastIH = 0;

  function measure() {
    const vv = window.visualViewport;
    const iw = Math.round(vv?.width || document.documentElement?.clientWidth || window.innerWidth || 0);
    const ih = Math.round(vv?.height || document.documentElement?.clientHeight || window.innerHeight || 0);
    return { iw, ih };
  }

  function onViewportMaybeChanged() {
    if (!document.documentElement.classList.contains("__viewproxy_attr")) return;
    const { iw, ih } = measure();
    if (iw === lastIW && ih === lastIH) return;
    lastIW = iw;
    lastIH = ih;
    if (refillTimer) clearTimeout(refillTimer);
    refillTimer = setTimeout(() => {
      refillTimer = null;
      requestRefill();
    }, 24);
  }

  window.addEventListener("resize", onViewportMaybeChanged, true);
  try {
    window.visualViewport?.addEventListener("resize", onViewportMaybeChanged);
    window.visualViewport?.addEventListener("scroll", onViewportMaybeChanged);
  } catch (_) {}

  // Seed sizes once DOM is up
  try {
    const m = measure();
    lastIW = m.iw;
    lastIH = m.ih;
  } catch (_) {}
})();
