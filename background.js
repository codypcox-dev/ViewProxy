/**
 * ViewProxy — service worker
 * Local only. No network. No analytics.
 *
 * Modes:
 *  Watch    — captureVisibleTab crop → proxy window (read-only pixels)
 *  Attract  — freeze page layout in MAIN world, translate box to origin,
 *             reshape the real tab's window to W×H (live + interactive)
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
 * Attract/Focus session: real tab reshaped to the box.
 * @type {{
 *   tabId: number,
 *   originalWindowId: number,
 *   originalIndex: number,
 *   originalHadOtherTabs: boolean,
 *   focusWindowId: number|null,
 *   box: {left:number,top:number,width:number,height:number},
 *   viewport: {w:number,h:number}
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
  // Attract window closed via OS X — still restore page + return tab to Chrome
  if (focusSession && windowId === focusSession.focusWindowId) {
    stopFocusMode().catch(() => {});
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

async function startWatchProxy({ tabId, pixelBox, viewport, mode = "watch" }) {
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
    url: chrome.runtime.getURL(
      `player/proxy.html?w=${box.width}&h=${box.height}&mode=${encodeURIComponent(mode)}`
    ),
    type: "popup",
    width: Math.max(100, box.width + 16),
    height: Math.max(80, box.height + 40),
    focused: true
  });
  proxyWindowId = win?.id ?? null;
  return { w: box.width, h: box.height, windowId: proxyWindowId, mode };
}

async function stopWatchProxy() {
  if (proxyWindowId != null) {
    try {
      await chrome.windows.remove(proxyWindowId);
    } catch (_) {}
    proxyWindowId = null;
  }
}

/**
 * Attract / Focus:
 *  1) Move tab into a popup (less chrome)
 *  2) Freeze page metrics in MAIN world (React sees frozen innerWidth)
 *  3) Translate content so the box sits at (0,0)
 *  4) Resize window client area to exact box W×H
 *
 * The tab stays fully live — window is the crop frame.
 */
async function startFocusMode({ tabId, pixelBox, viewport }) {
  await stopFocusMode();
  await stopWatchProxy();

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
  const vp = {
    w: Math.round(viewport?.w || 0) || 1280,
    h: Math.round(viewport?.h || 0) || 800
  };

  let origWin = null;
  try {
    origWin = await chrome.windows.get(tab.windowId);
  } catch (_) {}

  let origTabCount = 1;
  try {
    origTabCount = (await chrome.tabs.query({ windowId: tab.windowId })).length;
  } catch (_) {}

  const session = {
    tabId,
    originalWindowId: tab.windowId,
    originalIndex: tab.index,
    originalHadOtherTabs: origTabCount > 1,
    focusWindowId: null,
    box,
    viewport: vp
  };
  focusSession = session;
  await chrome.storage.session.set({ viewproxyFocusSession: session });
  await chrome.storage.local.set({ lastBox: box, lastViewport: vp });

  // Bridge first (isolated) so Exit button postMessage works
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/bridge.js"]
  });

  // 1) Popup at large size (same as original when possible)
  const startW = origWin?.width || Math.max(900, vp.w + 32);
  const startH = origWin?.height || Math.max(700, vp.h + 100);
  const win = await chrome.windows.create({
    tabId,
    type: "popup",
    focused: true,
    width: startW,
    height: startH,
    left: typeof origWin?.left === "number" ? origWin.left : undefined,
    top: typeof origWin?.top === "number" ? origWin.top : undefined
  });
  session.focusWindowId = win?.id ?? null;
  focusSession = session;
  await chrome.storage.session.set({ viewproxyFocusSession: session });

  await new Promise((r) => setTimeout(r, 100));

  // 2) Measure real chrome before freeze
  let chromeW = 16;
  let chromeH = 40;
  try {
    const m = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => ({
        iw: window.innerWidth,
        ih: window.innerHeight,
        ow: window.outerWidth,
        oh: window.outerHeight
      })
    });
    const r = m?.[0]?.result;
    if (r?.ow && r?.iw != null) {
      chromeW = Math.max(0, Math.min(48, r.ow - r.iw));
      chromeH = Math.max(24, Math.min(100, r.oh - r.ih));
    }
  } catch (_) {}

  // 3) MAIN-world attractor: freeze React metrics + translate box to origin
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["content/attractor-main.js"]
  });
  const applied = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (b, v) => {
      if (!window.__viewProxyAttractor) return { ok: false, error: "attractor missing" };
      return window.__viewProxyAttractor.apply(b, v);
    },
    args: [box, vp]
  });
  if (applied?.[0]?.result && applied[0].result.ok === false) {
    await stopFocusMode().catch(() => {});
    throw new Error(applied[0].result.error || "Attract failed");
  }

  // 4) Rewrite window dimensions to the box (the attractor)
  if (win?.id) {
    await chrome.windows.update(win.id, {
      width: Math.max(100, Math.round(box.width + chromeW)),
      height: Math.max(80, Math.round(box.height + chromeH))
    });
  }

  return {
    mode: "attract",
    w: box.width,
    h: box.height,
    windowId: session.focusWindowId
  };
}

/**
 * Exit Focus/Attract: restore page world, put tab back in normal Chrome.
 */
async function stopFocusMode() {
  let session = focusSession;
  if (!session) {
    try {
      const data = await chrome.storage.session.get("viewproxyFocusSession");
      session = data.viewproxyFocusSession || null;
    } catch (_) {}
  }
  focusSession = null;
  try {
    await chrome.storage.session.remove("viewproxyFocusSession");
  } catch (_) {}

  if (!session?.tabId) return;

  const { tabId, originalWindowId, originalIndex, originalHadOtherTabs, focusWindowId } =
    session;

  // 1) Unfreeze + unwrap in MAIN world
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["content/attractor-main.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (window.__viewProxyAttractor) {
          window.__viewProxyAttractor.restore({ keepExit: false });
        }
      }
    });
  } catch (_) {}

  // 2) Return tab to a normal Chrome window
  let moved = false;
  if (originalHadOtherTabs && originalWindowId != null) {
    try {
      await chrome.windows.get(originalWindowId);
      await chrome.tabs.move(tabId, {
        windowId: originalWindowId,
        index: Math.max(0, originalIndex ?? 0)
      });
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(originalWindowId, { focused: true });
      moved = true;
    } catch (_) {}
  }

  if (!moved) {
    try {
      await chrome.windows.create({
        tabId,
        type: "normal",
        focused: true,
        state: "maximized"
      });
      moved = true;
    } catch (_) {
      try {
        await chrome.windows.create({ tabId, focused: true });
      } catch (__) {}
    }
  }

  // 3) Close empty attract popup if it remains
  if (focusWindowId != null) {
    try {
      const fw = await chrome.windows.get(focusWindowId, { populate: true });
      if (!fw.tabs || fw.tabs.length === 0) {
        await chrome.windows.remove(focusWindowId);
      }
    } catch (_) {}
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
