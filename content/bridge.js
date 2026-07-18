/**
 * Isolated-world bridge: page main-world attractor → extension messaging.
 */
(function () {
  if (window.__viewProxyBridge) return;
  window.__viewProxyBridge = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "viewproxy") return;
    if (data.type === "exit-focus") {
      chrome.runtime.sendMessage({ type: "stop-focus-mode" }).catch(() => {});
    }
  });
})();
