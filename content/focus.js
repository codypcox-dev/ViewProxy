/**
 * ViewProxy Focus — input relay into the LIVE source tab
 *
 * Display is the proven Watch pixel stream (true-size, never black).
 * This script receives pointer/keyboard from the proxy and dispatches
 * real events at mapped coordinates on the source page so the tab
 * stays fully "up" and interactive without CSS reflow hacks.
 */
(function () {
  const VERSION = 3;

  /** @type {{left:number,top:number,width:number,height:number}|null} */
  let region = null;
  let lastTarget = null;

  window.__viewProxyFocusVersion = VERSION;

  window.__viewProxyFocusBeginRelay = function beginRelay(box) {
    region = {
      left: Math.round(box.left),
      top: Math.round(box.top),
      width: Math.max(1, Math.round(box.width)),
      height: Math.max(1, Math.round(box.height))
    };
    return { ok: true, region };
  };

  window.__viewProxyFocusEndRelay = function endRelay() {
    region = null;
    lastTarget = null;
    return { ok: true };
  };

  /**
   * Map proxy-local coords (0..region.W / 0..region.H) → page client coords
   */
  function toPage(localX, localY) {
    if (!region) return null;
    const x = region.left + localX;
    const y = region.top + localY;
    return { x, y };
  }

  function targetAt(x, y) {
    // Temporarily ensure our UI isn't in the way
    const root = document.getElementById("__viewproxy_root");
    const prev = root ? root.style.pointerEvents : null;
    if (root) root.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    if (root && prev != null) root.style.pointerEvents = prev;
    return el;
  }

  function dispatchMouse(type, x, y, extra = {}) {
    const el = targetAt(x, y) || document.body;
    if (!el) return;
    lastTarget = el;
    const init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
      button: extra.button ?? 0,
      buttons: extra.buttons ?? (type === "mouseup" ? 0 : 1),
      ctrlKey: !!extra.ctrlKey,
      shiftKey: !!extra.shiftKey,
      altKey: !!extra.altKey,
      metaKey: !!extra.metaKey,
      detail: extra.detail ?? (type === "click" || type === "dblclick" ? 1 : 0)
    };
    try {
      el.dispatchEvent(new PointerEvent(type.replace("mouse", "pointer"), {
        ...init,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      }));
    } catch (_) {}
    el.dispatchEvent(new MouseEvent(type, init));
  }

  window.__viewProxyFocusRelay = function relay(msg) {
    if (!region || !msg) return { ok: false };

    if (msg.kind === "pointer") {
      const p = toPage(msg.x, msg.y);
      if (!p) return { ok: false };
      const type = msg.event; // mousedown | mousemove | mouseup | click | dblclick
      dispatchMouse(type, p.x, p.y, msg);
      if (type === "mousedown" || type === "click") {
        try {
          lastTarget?.focus?.({ preventScroll: true });
        } catch (_) {}
      }
      return { ok: true };
    }

    if (msg.kind === "wheel") {
      const p = toPage(msg.x, msg.y);
      if (!p) return { ok: false };
      const el = targetAt(p.x, p.y) || document.body;
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
      return { ok: true };
    }

    if (msg.kind === "key") {
      const target = lastTarget || document.activeElement || document.body;
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
      target.dispatchEvent(new KeyboardEvent(msg.event, init)); // keydown | keyup | keypress
      // For printable chars, also try input
      if (msg.event === "keydown" && msg.key && msg.key.length === 1 && !msg.ctrlKey && !msg.metaKey && !msg.altKey) {
        try {
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            const start = target.selectionStart ?? target.value.length;
            const end = target.selectionEnd ?? target.value.length;
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
