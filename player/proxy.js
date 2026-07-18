/**
 * ViewProxy proxy window
 * - Watch: display pre-cropped frames full-bleed
 * - Focus: same display + relay pointer/keyboard to the live source tab
 */
const view = document.getElementById("view");
const meta = document.getElementById("meta");
const hit = document.getElementById("hit");
const exitBtn = document.getElementById("exit");
const params = new URLSearchParams(location.search);

let expectedW = parseInt(params.get("w") || "0", 10) || 0;
let expectedH = parseInt(params.get("h") || "0", 10) || 0;
const mode = params.get("mode") || "watch"; // watch | focus

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

  meta.textContent =
    (mode === "focus" ? "Focus " : "Watch ") + expectedW + "×" + expectedH + "px";
  setTimeout(() => meta.classList.add("fade"), 2200);

  if (mode === "focus") {
    document.body.classList.add("focus-mode");
    if (exitBtn) exitBtn.hidden = false;
    setupRelay();
  } else if (exitBtn) {
    exitBtn.hidden = true;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "exact-frame" && msg.dataUrl) {
      view.src = msg.dataUrl;
      if (msg.w && msg.h && (msg.w !== expectedW || msg.h !== expectedH)) {
        expectedW = msg.w;
        expectedH = msg.h;
        meta.textContent =
          (mode === "focus" ? "Focus " : "Watch ") + expectedW + "×" + expectedH + "px";
      }
    }
  });

  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      chrome.runtime
        .sendMessage({ type: mode === "focus" ? "stop-focus-mode" : "stop-exact-stream" })
        .catch(() => {});
      window.close();
    });
  }

  window.addEventListener("beforeunload", () => {
    chrome.runtime
      .sendMessage({
        type: mode === "focus" ? "stop-focus-mode" : "exact-player-closed"
      })
      .catch(() => {});
  });
}

function setupRelay() {
  const surface = hit || view;
  surface.style.pointerEvents = "auto";
  surface.style.cursor = "default";
  // Make focusable for keyboard
  surface.tabIndex = 0;
  surface.focus();

  function localXY(e) {
    const r = surface.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * expectedW;
    const y = ((e.clientY - r.top) / Math.max(1, r.height)) * expectedH;
    return {
      x: Math.max(0, Math.min(expectedW, x)),
      y: Math.max(0, Math.min(expectedH, y))
    };
  }

  function send(payload) {
    chrome.runtime.sendMessage({ type: "focus-relay", payload }).catch(() => {});
  }

  surface.addEventListener("mousedown", (e) => {
    e.preventDefault();
    surface.focus();
    const { x, y } = localXY(e);
    send({
      kind: "pointer",
      event: "mousedown",
      x,
      y,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
  });

  surface.addEventListener("mouseup", (e) => {
    e.preventDefault();
    const { x, y } = localXY(e);
    send({
      kind: "pointer",
      event: "mouseup",
      x,
      y,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
  });

  surface.addEventListener("click", (e) => {
    e.preventDefault();
    const { x, y } = localXY(e);
    send({
      kind: "pointer",
      event: "click",
      x,
      y,
      button: e.button,
      detail: 1,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
  });

  surface.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const { x, y } = localXY(e);
    send({
      kind: "pointer",
      event: "dblclick",
      x,
      y,
      button: e.button,
      detail: 2,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
  });

  surface.addEventListener("mousemove", (e) => {
    if (e.buttons === 0 && mode === "focus") {
      // light move traffic only while dragging
      return;
    }
    const { x, y } = localXY(e);
    send({
      kind: "pointer",
      event: "mousemove",
      x,
      y,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
  });

  surface.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const { x, y } = localXY(e);
      send({
        kind: "wheel",
        x,
        y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode
      });
    },
    { passive: false }
  );

  surface.addEventListener("keydown", (e) => {
    // Don't trap our own exit shortcut
    if (e.key === "Escape") {
      e.preventDefault();
      exitBtn?.click();
      return;
    }
    send({
      kind: "key",
      event: "keydown",
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
    // Avoid double-insert for text; relay handles input
    if (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter") {
      e.preventDefault();
    }
  });

  surface.addEventListener("keyup", (e) => {
    send({
      kind: "key",
      event: "keyup",
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey
    });
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
