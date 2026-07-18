/**
 * ViewProxy Focus — input relay into the LIVE source tab
 *
 * Display = proven Watch true-size pixel stream.
 * This script maps proxy pointer/keyboard → real events on the source page.
 * Region is stored on window so re-injection never wipes the session.
 */
(function () {
  const VERSION = 4;

  // Persist across re-injections
  if (!window.__viewProxyFocusStore) {
    window.__viewProxyFocusStore = { region: null, lastTarget: null };
  }
  const store = window.__viewProxyFocusStore;

  window.__viewProxyFocusVersion = VERSION;

  window.__viewProxyFocusBeginRelay = function beginRelay(box) {
    store.region = {
      left: Math.round(box.left),
      top: Math.round(box.top),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height))
    };
    store.lastTarget = null;
    return { ok: true, region: store.region };
  };

  window.__viewProxyFocusEndRelay = function endRelay() {
    store.region = null;
    store.lastTarget = null;
    return { ok: true };
  };

  function toPage(localX, localY) {
    const region = store.region;
    if (!region) return null;
    return {
      x: region.left + localX,
      y: region.top + localY
    };
  }

  function targetAt(x, y) {
    const root = document.getElementById("__viewproxy_root");
    const prev = root ? root.style.pointerEvents : null;
    if (root) root.style.pointerEvents = "none";
    let el = null;
    try {
      el = document.elementFromPoint(x, y);
    } catch (_) {}
    if (root && prev != null) root.style.pointerEvents = prev;
    return el;
  }

  function dispatchMouse(type, x, y, extra) {
    extra = extra || {};
    const el = targetAt(x, y) || document.body;
    if (!el) return;
    store.lastTarget = el;
    const init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: Math.round(x + (window.screenX || 0)),
      screenY: Math.round(y + (window.screenY || 0)),
      button: extra.button != null ? extra.button : 0,
      buttons: extra.buttons != null ? extra.buttons : type === "mouseup" ? 0 : 1,
      ctrlKey: !!extra.ctrlKey,
      shiftKey: !!extra.shiftKey,
      altKey: !!extra.altKey,
      metaKey: !!extra.metaKey,
      detail: extra.detail != null ? extra.detail : type === "click" || type === "dblclick" ? 1 : 0
    };
    try {
      el.dispatchEvent(
        new PointerEvent(type.indexOf("mouse") === 0 ? type.replace("mouse", "pointer") : type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          button: init.button,
          buttons: init.buttons,
          ctrlKey: init.ctrlKey,
          shiftKey: init.shiftKey,
          altKey: init.altKey,
          metaKey: init.metaKey
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent(type, init));
    } catch (_) {}
  }

  window.__viewProxyFocusRelay = function relay(msg) {
    if (!store.region || !msg) return { ok: false, reason: "no-region" };

    if (msg.kind === "pointer") {
      const p = toPage(msg.x, msg.y);
      if (!p) return { ok: false };
      dispatchMouse(msg.event, p.x, p.y, msg);
      if (msg.event === "mousedown" || msg.event === "click") {
        try {
          if (store.lastTarget && store.lastTarget.focus) {
            store.lastTarget.focus({ preventScroll: true });
          }
        } catch (_) {}
      }
      return { ok: true };
    }

    if (msg.kind === "wheel") {
      const p = toPage(msg.x, msg.y);
      if (!p) return { ok: false };
      const el = targetAt(p.x, p.y) || document.body;
      try {
        el.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: p.x,
            clientY: p.y,
            deltaX: msg.deltaX || 0,
            deltaY: msg.deltaY || 0,
            deltaMode: msg.deltaMode || 0
          })
        );
      } catch (_) {}
      return { ok: true };
    }

    if (msg.kind === "key") {
      const target = store.lastTarget || document.activeElement || document.body;
      const init = {
        bubbles: true,
        cancelable: true,
        key: msg.key,
        code: msg.code,
        keyCode: msg.keyCode,
        which: msg.keyCode,
        ctrlKey: !!msg.ctrlKey,
        shiftKey: !!msg.shiftKey,
        altKey: !!msg.altKey,
        metaKey: !!msg.metaKey
      };
      try {
        target.dispatchEvent(new KeyboardEvent(msg.event, init));
      } catch (_) {}
      if (
        msg.event === "keydown" &&
        msg.key &&
        msg.key.length === 1 &&
        !msg.ctrlKey &&
        !msg.metaKey &&
        !msg.altKey
      ) {
        try {
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            const start = target.selectionStart != null ? target.selectionStart : target.value.length;
            const end = target.selectionEnd != null ? target.selectionEnd : target.value.length;
            const v = target.value;
            target.value = v.slice(0, start) + msg.key + v.slice(end);
            target.selectionStart = target.selectionEnd = start + 1;
            target.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (target.isContentEditable) {
            document.execCommand("insertText", false, msg.key);
          }
        } catch (_) {}
      }
      return { ok: true };
    }

    return { ok: false };
  };
})();
