/**
 * ViewProxy — dumb full-bleed display for pre-cropped frames.
 */
const view = document.getElementById("view");
const meta = document.getElementById("meta");
const params = new URLSearchParams(location.search);

let expectedW = parseInt(params.get("w") || "0", 10) || 0;
let expectedH = parseInt(params.get("h") || "0", 10) || 0;

init().catch((err) => {
  meta.textContent = String(err?.message || err);
});

async function init() {
  let winId = null;
  try {
    const win = await chrome.windows.getCurrent();
    winId = win?.id ?? null;
  } catch (_) {}

  if (winId && expectedW > 0 && expectedH > 0) {
    await fitClientArea(winId, expectedW, expectedH);
  }

  meta.textContent = `ViewProxy ${expectedW}×${expectedH}px`;
  setTimeout(() => meta.classList.add("fade"), 2200);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "exact-frame" && msg.dataUrl) {
      view.src = msg.dataUrl;
      if (msg.w && msg.h && (msg.w !== expectedW || msg.h !== expectedH)) {
        expectedW = msg.w;
        expectedH = msg.h;
        meta.textContent = `ViewProxy ${expectedW}×${expectedH}px`;
        meta.classList.remove("fade");
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    chrome.runtime.sendMessage({ type: "exact-player-closed" }).catch(() => {});
  });
}

async function fitClientArea(winId, clientW, clientH) {
  try {
    const before = await chrome.windows.get(winId);
    const chromeW = Math.max(0, (before.width || 0) - window.innerWidth);
    const chromeH = Math.max(0, (before.height || 0) - window.innerHeight);
    await chrome.windows.update(winId, {
      width: Math.max(80, clientW + chromeW),
      height: Math.max(60, clientH + chromeH)
    });
    await new Promise((r) => setTimeout(r, 50));
    const chromeW2 = Math.max(0, window.outerWidth - window.innerWidth);
    const chromeH2 = Math.max(0, window.outerHeight - window.innerHeight);
    await chrome.windows.update(winId, {
      width: Math.max(80, clientW + chromeW2),
      height: Math.max(60, clientH + chromeH2)
    });
  } catch (_) {}
}
