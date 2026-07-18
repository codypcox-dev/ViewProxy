/**
 * ViewProxy — service worker
 * Local only. No network. No analytics.
 *
 * Modes:
 *  Watch  — captureVisibleTab crop → proxy window (read-only pixels)
 *  Focus  — re-frame the REAL tab into a tight popup (live + interactive)
 */

const DEFAULTS = {
  lastBox: null,
  lastViewport: null
};

/** @type {number|null} */
let targetTabId = null;
/** @type {number|null} */
let proxyWindowId = null;
/** @type {number|null} */
let panelWindowId = null;

/**
 * @type {{
 *   tabId: number,
 *   originalWindowId: number,
 *   originalIndex: number,
 *   focusWindowId: number|null,
 *   box: {left:number,top:number,width:number,height:number}
 * }|null}
 */
let focusSession = null;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(null);
  const patch = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (stored[k] === undefined) patch[k] = v;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await ensureMenus();
});

chrome.runtime.onStartup.addListener(() => {
  ensureMenus().catch(() => {});
});

async function ensureMenus() {
  await chrome.contextMenus.removeAll();
  const items = [
    { id: "select", title: "Select region" },
    { id: "video", title: "Crop video…" },
    { id: "panel", title: "Open control panel" },
    { id: "stop", title: "Stop Watch / Focus" }
  ];
  for (const item of items) {
    chrome.contextMenus.create({
      id: item.id,
      contexts: ["action"],
      title: item.title
    });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !isInjectableUrl(tab.url)) {
    await openPanel();
    return;
  }
  targetTabId = tab.id;
  try {
    await injectSelect(tab.id);
  } catch (err) {
    console.error("[ViewProxy]", err);
    await openPanel();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id ?? (await getTargetTab())?.id;
  if (tabId) targetTabId = tabId;

  switch (info.menuItemId) {
    case "select":
      if (tabId) await injectSelect(tabId);
      break;
    case "video":
      if (tabId) await injectVideo(tabId, { action: "freeform" });
      break;
    case "panel":
      await openPanel();
      break;
    case "stop":
      await stopAll(tabId);
      break;
    default:
      break;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getTargetTab();
  if (command === "open-panel") {
    await openPanel();
    return;
  }
  if (command === "stop-stream") {
    await stopAll(tab?.id ?? null);
    return;
  }
  if (!tab?.id || !isInjectableUrl(tab.url)) return;
  targetTabId = tab.id;
  if (command === "select-region") {
    await injectSelect(tab.id);
  } else if (command === "video-crop") {
    await injectVideo(tab.id, { action: "freeform" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "start-exact-stream") {
    (async () => {
      try {
        const tabId = sender.tab?.id || targetTabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "No tab id." });
          return;
        }
        if (!message.pixelBox) {
          sendResponse({ ok: false, error: "pixelBox required." });
          return;
        }
        // Leaving focus mode if active
        await stopFocusMode().catch(() => {});
        targetTabId = tabId;
        const result = await startWatchProxy({
          tabId,
          pixelBox: message.pixelBox,
          viewport: message.viewport || null
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "start-focus-mode") {
    (async () => {
      try {
        const tabId = sender.tab?.id || targetTabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "No tab id." });
          return;
        }
        if (!message.pixelBox) {
          sendResponse({ ok: false, error: "pixelBox required." });
          return;
        }
        await stopWatchProxy().catch(() => {});
        targetTabId = tabId;
        const result = await startFocusMode({
          tabId,
          pixelBox: message.pixelBox,
          viewport: message.viewport || null
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "stop-exact-stream" || type === "exact-player-closed") {
    stopWatchProxy()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (type === "stop-focus-mode") {
    stopFocusMode()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (type === "capture-visible-tab") {
    (async () => {
      try {
        const tabId = message.tabId || sender.tab?.id || targetTabId;
        if (!tabId) {
          sendResponse({ ok: false, error: "No tab to capture." });
          return;
        }
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png"
        });
        sendResponse({ ok: true, dataUrl });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (type === "exact-frame" && message.dataUrl) {
    chrome.runtime
      .sendMessage({
        type: "exact-frame",
        dataUrl: message.dataUrl,
        w: message.w,
        h: message.h
      })
      .catch(() => {});
    return false;
  }

  if (type === "run-on-active-tab") {
    handlePanelAction(message.payload)
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (type === "get-target-info") {
    getTargetTab().then((tab) => {
      sendResponse({
        ok: true,
        tabId: tab?.id ?? null,
        title: tab?.title ?? "",
        url: tab?.url ?? "",
        focusActive: !!focusSession
      });
    });
    return true;
  }

  if (type === "save-rect" && message.rect) {
    chrome.storage.local.set({ lastRect: message.rect }).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === proxyWindowId) {
    proxyWindowId = null;
  }
  if (windowId === panelWindowId) {
    panelWindowId = null;
  }
  // If the focus popup is closed by the user, try to restore page styles
  // (tab may have been closed with the window)
  if (focusSession && windowId === focusSession.focusWindowId) {
    const tabId = focusSession.tabId;
    focusSession = null;
    chrome.scripting
      .executeScript({
        target: { tabId },
        func: () => {
          if (typeof window.__viewProxyFocusRestore === "function") {
            window.__viewProxyFocusRestore();
          }
        }
      })
      .catch(() => {});
  }
});

async function stopAll(tabId) {
  await stopWatchProxy();
  await stopFocusMode();
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "viewproxy-stop" });
    } catch (_) {}
  }
}

// ── Watch mode (pixel stream) ───────────────────────────────────────

async function startWatchProxy({ tabId, pixelBox, viewport }) {
  await stopWatchProxy();

  const vw = Math.round(viewport?.w || 1920);
  const vh = Math.round(viewport?.h || 1080);
  const box = {
    left: Math.round(pixelBox.left),
    top: Math.round(pixelBox.top),
    width: Math.max(1, Math.round(pixelBox.width)),
    height: Math.max(1, Math.round(pixelBox.height))
  };

  await chrome.storage.local.set({
    lastBox: box,
    lastViewport: { w: vw, h: vh }
  });

  targetTabId = tabId;

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`player/proxy.html?w=${box.width}&h=${box.height}`),
    type: "popup",
    width: Math.max(100, box.width + 16),
    height: Math.max(80, box.height + 40),
    focused: true
  });
  proxyWindowId = win?.id ?? null;
  return { w: box.width, h: box.height, windowId: proxyWindowId, mode: "watch" };
}

async function stopWatchProxy() {
  if (proxyWindowId != null) {
    try {
      await chrome.windows.remove(proxyWindowId);
    } catch (_) {}
    proxyWindowId = null;
  }
}

// ── Focus mode (live tab re-frame) ──────────────────────────────────

async function startFocusMode({ tabId, pixelBox }) {
  await stopFocusMode();

  const tab = await chrome.tabs.get(tabId);
  if (!isInjectableUrl(tab.url)) {
    throw new Error("Cannot focus this page.");
  }

  const box = {
    left: Math.round(pixelBox.left),
    top: Math.round(pixelBox.top),
    width: Math.max(1, Math.round(pixelBox.width)),
    height: Math.max(1, Math.round(pixelBox.height))
  };

  focusSession = {
    tabId,
    originalWindowId: tab.windowId,
    originalIndex: tab.index,
    focusWindowId: null,
    box
  };

  await chrome.storage.local.set({ lastBox: box });

  // 1) Apply framing WHILE the layout still matches the measured box
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/focus.js"]
  });
  const applied = await chrome.scripting.executeScript({
    target: { tabId },
    func: (b) => {
      if (typeof window.__viewProxyFocusApply !== "function") {
        return { ok: false, error: "focus.js missing" };
      }
      return window.__viewProxyFocusApply(b);
    },
    args: [box]
  });
  if (applied?.[0]?.result && applied[0].result.ok === false) {
    focusSession = null;
    throw new Error(applied[0].result.error || "Focus apply failed");
  }

  // 2) Move this tab into a tight popup window (real tab, less chrome)
  const win = await chrome.windows.create({
    tabId,
    type: "popup",
    focused: true,
    width: Math.max(120, box.width + 16),
    height: Math.max(100, box.height + 42)
  });
  focusSession.focusWindowId = win?.id ?? null;

  // 3) Refine outer size so client area ≈ box
  if (win?.id) {
    await refineFocusWindowSize(win.id, box.width, box.height);
  }

  return {
    mode: "focus",
    w: box.width,
    h: box.height,
    windowId: focusSession.focusWindowId
  };
}

async function refineFocusWindowSize(windowId, clientW, clientH) {
  try {
    // First guess
    await chrome.windows.update(windowId, {
      width: Math.max(120, clientW + 16),
      height: Math.max(100, clientH + 42)
    });
    await new Promise((r) => setTimeout(r, 80));

    // Measure chrome from a script in the focused tab if possible
    const w = await chrome.windows.get(windowId, { populate: true });
    const tab = w.tabs && w.tabs[0];
    if (!tab?.id) return;

    const measure = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        outerW: window.outerWidth,
        outerH: window.outerHeight
      })
    });
    const m = measure?.[0]?.result;
    if (!m) return;

    const chromeW = Math.max(0, m.outerW - m.innerW);
    const chromeH = Math.max(0, m.outerH - m.innerH);
    await chrome.windows.update(windowId, {
      width: Math.max(120, Math.round(clientW + chromeW)),
      height: Math.max(100, Math.round(clientH + chromeH))
    });
  } catch (_) {}
}

async function stopFocusMode() {
  if (!focusSession) return;
  const session = focusSession;
  focusSession = null;

  const { tabId, originalWindowId, originalIndex } = session;

  // Restore page styles first
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/focus.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof window.__viewProxyFocusRestore === "function") {
          window.__viewProxyFocusRestore(true);
        }
      }
    });
  } catch (_) {
    // tab may already be closed
  }

  // Move tab back to original window if it still exists
  try {
    await chrome.windows.get(originalWindowId);
    await chrome.tabs.move(tabId, {
      windowId: originalWindowId,
      index: Math.max(0, originalIndex)
    });
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(originalWindowId, { focused: true });
  } catch (_) {
    // original window gone — leave tab where it is, just un-focused styles
  }
}

// ── helpers ─────────────────────────────────────────────────────────

async function injectSelect(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ["content/select.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: () => {
      if (typeof window.__viewProxyHandle === "function") {
        window.__viewProxyHandle({ action: "region" });
      }
    }
  });
}

async function injectVideo(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content/video.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (p) => {
      if (typeof window.__viewProxyVideoHandle === "function") {
        window.__viewProxyVideoHandle(p);
      }
    },
    args: [payload]
  });
}

async function handlePanelAction(payload) {
  const tab = await getTargetTab();
  if (!tab?.id) return { ok: false, error: "No target tab. Click ViewProxy on a page first." };
  if (!isInjectableUrl(tab.url)) {
    return { ok: false, error: "Cannot script this page (chrome://, Web Store, etc.)." };
  }
  targetTabId = tab.id;
  const action = payload?.action;
  if (action === "page-region" || action === "region") {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
    } catch (_) {}
    await injectSelect(tab.id);
    return { ok: true, hint: "Draw a box, then Watch or Focus." };
  }
  if (action === "stop-page" || action === "stop") {
    await stopAll(tab.id);
    return { ok: true };
  }
  if (action === "freeform" || action === "pip") {
    await injectVideo(tab.id, payload);
    return { ok: true };
  }
  return { ok: false, error: "Unknown action." };
}

async function openPanel() {
  if (panelWindowId != null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      return;
    } catch (_) {
      panelWindowId = null;
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("popup/popup.html"),
    type: "popup",
    width: 360,
    height: 460,
    focused: true
  });
  panelWindowId = win?.id ?? null;
}

async function getTargetTab() {
  if (targetTabId != null) {
    try {
      const t = await chrome.tabs.get(targetTabId);
      if (t && isInjectableUrl(t.url)) return t;
    } catch (_) {
      targetTabId = null;
    }
  }
  if (focusSession?.tabId) {
    try {
      const t = await chrome.tabs.get(focusSession.tabId);
      if (t) return t;
    } catch (_) {}
  }
  const normalWins = await chrome.windows.getAll({
    populate: false,
    windowTypes: ["normal"]
  });
  normalWins.sort((a, b) => Number(b.focused) - Number(a.focused));
  for (const w of normalWins) {
    const [active] = await chrome.tabs.query({ active: true, windowId: w.id });
    if (active && isInjectableUrl(active.url)) {
      targetTabId = active.id;
      return active;
    }
  }
  // Also check popup windows (focus mode lives there)
  const popups = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["popup"]
  });
  for (const w of popups) {
    if (w.tabs) {
      for (const t of w.tabs) {
        if (isInjectableUrl(t.url)) return t;
      }
    }
  }
  return null;
}

function isInjectableUrl(url) {
  if (!url) return false;
  return /^(https?:|file:)/i.test(url);
}
