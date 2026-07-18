/**
 * ViewProxy — service worker
 * Local only. No network. No analytics.
 *
 * Modes:
 *  Watch  — captureVisibleTab crop → proxy window (read-only)
 *  Focus  — same true-size pixel stream + input relay into the LIVE source tab
 *           (tab stays full-size in Chrome; proxy is the interactive view)
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
 * Focus session: source tab stays put; proxy streams + relays input.
 * @type {{
 *   tabId: number,
 *   sourceWindowId: number,
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

  // Proxy → source tab input relay (Focus mode)
  if (type === "focus-relay" && message.payload) {
    (async () => {
      try {
        let session = focusSession;
        if (!session?.tabId) {
          try {
            const data = await chrome.storage.session.get("viewproxyFocusSession");
            session = data.viewproxyFocusSession || null;
            if (session) focusSession = session;
          } catch (_) {}
        }
        if (!session?.tabId) {
          sendResponse({ ok: false, reason: "no-session" });
          return;
        }
        // Only inject file if relay fn missing (avoid wiping state)
        const check = await chrome.scripting.executeScript({
          target: { tabId: session.tabId },
          func: () => typeof window.__viewProxyFocusRelay === "function"
        });
        if (!check?.[0]?.result) {
          await chrome.scripting.executeScript({
            target: { tabId: session.tabId },
            files: ["content/focus.js"]
          });
          // Re-bind region after cold inject
          await chrome.scripting.executeScript({
            target: { tabId: session.tabId },
            func: (b) => {
              if (typeof window.__viewProxyFocusBeginRelay === "function") {
                window.__viewProxyFocusBeginRelay(b);
              }
            },
            args: [session.box]
          });
        }
        const res = await chrome.scripting.executeScript({
          target: { tabId: session.tabId },
          func: (payload) => {
            if (typeof window.__viewProxyFocusRelay === "function") {
              return window.__viewProxyFocusRelay(payload);
            }
            return { ok: false };
          },
          args: [message.payload]
        });
        sendResponse(res?.[0]?.result || { ok: false });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
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
    // Closing the Focus/Watch proxy ends the session; bring source tab forward on Focus
    if (focusSession) {
      const s = focusSession;
      focusSession = null;
      chrome.scripting
        .executeScript({
          target: { tabId: s.tabId },
          func: () => {
            if (typeof window.__viewProxyFocusEndRelay === "function") {
              window.__viewProxyFocusEndRelay();
            }
          }
        })
        .catch(() => {});
      // Don't auto-focus source on X — user may just be dismissing the mirror
    }
  }
  if (windowId === panelWindowId) {
    panelWindowId = null;
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
 * Focus = proven true-size Watch stream + click/key relay into the LIVE source tab.
 * Source tab stays full-size in Chrome (always "up"); no CSS reframe (no black SPA shell).
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

  // Install relay on source tab
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/focus.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (b) => {
      if (typeof window.__viewProxyFocusBeginRelay === "function") {
        return window.__viewProxyFocusBeginRelay(b);
      }
      return { ok: false };
    },
    args: [box]
  });

  focusSession = {
    tabId,
    sourceWindowId: tab.windowId,
    box,
    viewport: vp
  };
  await chrome.storage.session.set({ viewproxyFocusSession: focusSession });
  await chrome.storage.local.set({ lastBox: box, lastViewport: vp });

  // Same true-size proxy as Watch (mode=focus enables hit layer + Exit)
  const opened = await startWatchProxy({
    tabId,
    pixelBox: box,
    viewport: vp,
    mode: "focus"
  });

  return {
    mode: "focus",
    w: box.width,
    h: box.height,
    windowId: opened.windowId
  };
}

/**
 * Exit Focus: stop proxy, end relay, bring the source tab back to the front in Chrome.
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

  // Close the proxy mirror
  await stopWatchProxy();

  if (!session?.tabId) return;

  // End relay on source
  try {
    await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      files: ["content/focus.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId: session.tabId },
      func: () => {
        if (typeof window.__viewProxyFocusEndRelay === "function") {
          window.__viewProxyFocusEndRelay();
        }
      }
    });
  } catch (_) {}

  // Return user to the real tab in Chrome
  try {
    const t = await chrome.tabs.get(session.tabId);
    await chrome.windows.update(t.windowId, { focused: true, state: "normal" });
    await chrome.tabs.update(session.tabId, { active: true });
  } catch (_) {
    // Tab gone
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
