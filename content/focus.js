/**
 * ViewProxy Focus mode — re-frame the REAL tab to a CSS-pixel box.
 * Live DOM, real clicks, no screenshot loop.
 *
 * Strategy:
 *  - translate the page so the box sits at (0,0)
 *  - clip overflow so only that region is visible/hittable in a tight window
 *  - restore styles + optional exit control when stopped
 */
(function () {
  const STYLE_ID = "__viewproxy_focus_style";
  const EXIT_ID = "__viewproxy_focus_exit";
  const FLAG = "__viewproxy_focus";

  window.__viewProxyFocusApply = function apply(box) {
    if (!box || box.width < 2 || box.height < 2) {
      throw new Error("Invalid focus box");
    }

    // Idempotent re-apply
    if (window.__viewProxyFocusState) {
      restore(false);
    }

    const L = Math.round(box.left);
    const T = Math.round(box.top);
    const W = Math.max(1, Math.round(box.width));
    const H = Math.max(1, Math.round(box.height));

    const state = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      htmlClass: document.documentElement.className,
      htmlOverflow: document.documentElement.style.overflow,
      htmlWidth: document.documentElement.style.width,
      htmlHeight: document.documentElement.style.height,
      bodyOverflow: document.body ? document.body.style.overflow : "",
      bodyTransform: document.body ? document.body.style.transform : "",
      bodyOrigin: document.body ? document.body.style.transformOrigin : "",
      bodyWidth: document.body ? document.body.style.width : "",
      bodyMinHeight: document.body ? document.body.style.minHeight : "",
      box: { left: L, top: T, width: W, height: H }
    };

    // Prefer pinning via transform on <html> so fixed children usually move too
    const css = `
      html.${FLAG} {
        overflow: hidden !important;
        width: ${W}px !important;
        height: ${H}px !important;
        max-width: ${W}px !important;
        max-height: ${H}px !important;
      }
      html.${FLAG} body {
        overflow: hidden !important;
        transform: translate(${-L}px, ${-T}px) !important;
        transform-origin: 0 0 !important;
        /* keep full layout width so content does not reflow under the crop */
        min-width: ${Math.max(document.documentElement.scrollWidth, window.innerWidth)}px !important;
      }
      /* Dim / block anything that still peeks outside the focus viewport */
      html.${FLAG}::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        box-shadow: 0 0 0 100vmax rgba(0,0,0,0.92);
        z-index: 2147483645;
      }
      #${EXIT_ID} {
        position: fixed !important;
        top: 8px !important;
        right: 8px !important;
        z-index: 2147483647 !important;
        border: 1px solid rgba(255,255,255,0.2) !important;
        border-radius: 8px !important;
        background: rgba(15,23,42,0.92) !important;
        color: #f8fafc !important;
        font: 700 11px/1 system-ui,sans-serif !important;
        padding: 8px 10px !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        box-shadow: 0 6px 20px rgba(0,0,0,0.35) !important;
        transform: none !important;
      }
      #${EXIT_ID}:hover {
        background: rgba(127,29,29,0.95) !important;
      }
    `;

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = css;

    document.documentElement.classList.add(FLAG);
    document.documentElement.style.setProperty("overflow", "hidden", "important");
    document.documentElement.style.setProperty("width", W + "px", "important");
    document.documentElement.style.setProperty("height", H + "px", "important");

    if (document.body) {
      document.body.style.setProperty("overflow", "hidden", "important");
      document.body.style.setProperty("transform", `translate(${-L}px, ${-T}px)`, "important");
      document.body.style.setProperty("transform-origin", "0 0", "important");
    }

    // Exit control (not affected by body transform — fixed on html viewport)
    let exit = document.getElementById(EXIT_ID);
    if (!exit) {
      exit = document.createElement("button");
      exit.id = EXIT_ID;
      exit.type = "button";
      exit.textContent = "✕ Exit Focus";
      exit.title = "Restore full page";
      exit.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          chrome.runtime.sendMessage({ type: "stop-focus-mode" }).catch(() => {
            restore(true);
          });
        },
        true
      );
      document.documentElement.appendChild(exit);
    }

    window.__viewProxyFocusState = state;
    window.__viewProxyFocusBox = { left: L, top: T, width: W, height: H };
    return { ok: true, box: window.__viewProxyFocusBox };
  };

  window.__viewProxyFocusRestore = function restore(removeExit = true) {
    const state = window.__viewProxyFocusState;
    document.documentElement.classList.remove(FLAG);

    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();

    if (removeExit) {
      document.getElementById(EXIT_ID)?.remove();
    }

    if (state) {
      document.documentElement.style.overflow = state.htmlOverflow || "";
      document.documentElement.style.width = state.htmlWidth || "";
      document.documentElement.style.height = state.htmlHeight || "";
      if (document.body) {
        document.body.style.overflow = state.bodyOverflow || "";
        document.body.style.transform = state.bodyTransform || "";
        document.body.style.transformOrigin = state.bodyOrigin || "";
        document.body.style.width = state.bodyWidth || "";
        document.body.style.minHeight = state.bodyMinHeight || "";
      }
      try {
        window.scrollTo(state.scrollX || 0, state.scrollY || 0);
      } catch (_) {}
    } else {
      document.documentElement.style.overflow = "";
      document.documentElement.style.width = "";
      document.documentElement.style.height = "";
      if (document.body) {
        document.body.style.overflow = "";
        document.body.style.transform = "";
        document.body.style.transformOrigin = "";
      }
    }

    window.__viewProxyFocusState = null;
    window.__viewProxyFocusBox = null;
    return { ok: true };
  };

  window.__viewProxyFocusIsActive = function () {
    return !!window.__viewProxyFocusState;
  };
})();
