/**
 * ViewProxy — service worker
 * Local only. No network. No analytics.
 *
 * Flow:
 *  1. Toolbar click → inject select UI on the active tab
 *  2. User draws a CSS-pixel box (page clicks blocked)
 *  3. Content script captures tab, crops exact box, sends frames
 *  4. This worker opens a proxy window and forwards frames to it
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
    { id: "stop", title: "Stop stream" }
  ];
  for (const item of items) {
    chrome.contextMenus.create({
      id: item.id,
      contexts: ["action"],
      title: item.title
    });
  }
}

// Toolbar click → select on this tab
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
      await stopProxy();
      if (tabId) {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "viewproxy-stop" });
        } catch (_) {}
      }
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
    await stopProxy();
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "viewproxy-stop" });
      } catch (_) {}
    }
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
        targetTabId = tabId;
        const result = await startProxy({
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
    stopProxy()
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

  // Content script → service worker → proxy page
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
        url: tab?.url ?? ""
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
});

async function startProxy({ tabId, pixelBox, viewport }) {
  await stopProxy();

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
      `player/proxy.html?w=${box.width}&h=${box.height}`
    ),
    type: "popup",
    width: Math.max(100, box.width + 16),
    height: Math.max(80, box.height + 40),
    focused: true
  });
  proxyWindowId = win?.id ?? null;
  return { w: box.width, h: box.height, windowId: proxyWindowId };
}

async function stopProxy() {
  if (proxyWindowId != null) {
    try {
      await chrome.windows.remove(proxyWindowId);
    } catch (_) {}
    proxyWindowId = null;
  }
}

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
    return { ok: true, hint: "Draw a box on the page." };
  }
  if (action === "stop-page" || action === "stop") {
    await stopProxy();
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "viewproxy-stop" });
    } catch (_) {}
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
    height: 420,
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
  return null;
}

function isInjectableUrl(url) {
  if (!url) return false;
  return /^(https?:|file:)/i.test(url);
}
