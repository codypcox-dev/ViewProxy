/**
 * ViewProxy Focus — true-size live re-frame
 *
 * Critical: do NOT set html/body layout width to the box size.
 * That reflows SPAs (black empty shells). Freeze layout at the
 * pre-focus viewport width, translate so the box sits at (0,0),
 * then let the OS window client area be exactly W×H (like Watch).
 */
(function () {
  const STYLE_ID = "__viewproxy_focus_style";
  const EXIT_ID = "__viewproxy_focus_exit";
  const FLAG = "__viewproxy_focus";

  /**
   * @param {{left:number,top:number,width:number,height:number}} box
   * @param {{w:number,h:number}|null} viewport  selection-time inner size
   */
  window.__viewProxyFocusApply = function apply(box, viewport) {
    if (!box || box.width < 2 || box.height < 2) {
      throw new Error("Invalid focus box");
    }

    if (window.__viewProxyFocusState) {
      restore(false);
    }

    const L = Math.round(box.left);
    const T = Math.round(box.top);
    const W = Math.max(1, Math.round(box.width));
    const H = Math.max(1, Math.round(box.height));

    // Freeze layout to the viewport that produced L/T/W/H
    const layoutW = Math.max(
      W,
      Math.round(viewport?.w || window.innerWidth || document.documentElement.clientWidth || 1280)
    );
    const layoutH = Math.max(
      H,
      Math.round(viewport?.h || window.innerHeight || document.documentElement.clientHeight || 800)
    );

    const state = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      htmlOverflow: document.documentElement.style.overflow,
      htmlWidth: document.documentElement.style.width,
      htmlMinWidth: document.documentElement.style.minWidth,
      htmlHeight: document.documentElement.style.height,
      htmlMaxHeight: document.documentElement.style.maxHeight,
      bodyOverflow: document.body ? document.body.style.overflow : "",
      bodyTransform: document.body ? document.body.style.transform : "",
      bodyOrigin: document.body ? document.body.style.transformOrigin : "",
      bodyWidth: document.body ? document.body.style.width : "",
      bodyMinWidth: document.body ? document.body.style.minWidth : "",
      bodyMargin: document.body ? document.body.style.margin : "",
      bodyPadding: document.body ? document.body.style.padding : "",
      box: { left: L, top: T, width: W, height: H },
      layoutW,
      layoutH
    };

    // Optional: pin visual viewport meta so some mobile-ish pages don't reflow
    let metaVp = document.querySelector('meta[name="viewport"]');
    if (metaVp) {
      state.metaViewport = metaVp.getAttribute("content");
      metaVp.setAttribute("content", "width=" + layoutW + ", initial-scale=1, maximum-scale=1");
    } else {
      metaVp = document.createElement("meta");
      metaVp.name = "viewport";
      metaVp.content = "width=" + layoutW + ", initial-scale=1, maximum-scale=1";
      metaVp.setAttribute("data-viewproxy", "1");
      (document.head || document.documentElement).appendChild(metaVp);
      state.metaViewportCreated = true;
    }

    const css = `
      html.${FLAG} {
        overflow: hidden !important;
        /* KEEP full layout width — window size provides the crop, not reflow */
        width: ${layoutW}px !important;
        min-width: ${layoutW}px !important;
        max-width: none !important;
        height: ${layoutH}px !important;
        min-height: ${layoutH}px !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      html.${FLAG} body {
        overflow: visible !important;
        margin: 0 !important;
        transform: translate(${-L}px, ${-T}px) !important;
        transform-origin: 0 0 !important;
        width: ${layoutW}px !important;
        min-width: ${layoutW}px !important;
      }
      /* Exit control lives in the visible W×H viewport (not transformed with body) */
      #${EXIT_ID} {
        position: fixed !important;
        top: 6px !important;
        right: 6px !important;
        z-index: 2147483647 !important;
        border: 1px solid rgba(255,255,255,0.18) !important;
        border-radius: 8px !important;
        background: rgba(15,23,42,0.88) !important;
        color: #f8fafc !important;
        font: 700 11px/1 system-ui,sans-serif !important;
        padding: 7px 9px !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.35) !important;
        transform: none !important;
        opacity: 0.35 !important;
        transition: opacity 0.15s ease !important;
      }
      #${EXIT_ID}:hover {
        opacity: 1 !important;
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
    document.documentElement.style.setProperty("width", layoutW + "px", "important");
    document.documentElement.style.setProperty("min-width", layoutW + "px", "important");
    document.documentElement.style.setProperty("height", layoutH + "px", "important");

    if (document.body) {
      document.body.style.setProperty("overflow", "visible", "important");
      document.body.style.setProperty("margin", "0", "important");
      document.body.style.setProperty("transform", `translate(${-L}px, ${-T}px)`, "important");
      document.body.style.setProperty("transform-origin", "0 0", "important");
      document.body.style.setProperty("width", layoutW + "px", "important");
      document.body.style.setProperty("min-width", layoutW + "px", "important");
    }

    // Prevent scroll from shifting the crop
    try {
      window.scrollTo(0, 0);
    } catch (_) {}

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
    window.__viewProxyFocusBox = { left: L, top: T, width: W, height: H, layoutW, layoutH };
    return { ok: true, box: window.__viewProxyFocusBox };
  };

  window.__viewProxyFocusRestore = function restore(removeExit = true) {
    const state = window.__viewProxyFocusState;
    document.documentElement.classList.remove(FLAG);

    document.getElementById(STYLE_ID)?.remove();
    if (removeExit) document.getElementById(EXIT_ID)?.remove();

    if (state) {
      if (state.metaViewportCreated) {
        document.querySelector('meta[name="viewport"][data-viewproxy="1"]')?.remove();
      } else if (state.metaViewport != null) {
        const m = document.querySelector('meta[name="viewport"]');
        if (m) m.setAttribute("content", state.metaViewport);
      }

      document.documentElement.style.overflow = state.htmlOverflow || "";
      document.documentElement.style.width = state.htmlWidth || "";
      document.documentElement.style.minWidth = state.htmlMinWidth || "";
      document.documentElement.style.height = state.htmlHeight || "";
      document.documentElement.style.maxHeight = state.htmlMaxHeight || "";

      if (document.body) {
        document.body.style.overflow = state.bodyOverflow || "";
        document.body.style.transform = state.bodyTransform || "";
        document.body.style.transformOrigin = state.bodyOrigin || "";
        document.body.style.width = state.bodyWidth || "";
        document.body.style.minWidth = state.bodyMinWidth || "";
        document.body.style.margin = state.bodyMargin || "";
        document.body.style.padding = state.bodyPadding || "";
      }
      try {
        window.scrollTo(state.scrollX || 0, state.scrollY || 0);
      } catch (_) {}
    } else {
      document.documentElement.style.overflow = "";
      document.documentElement.style.width = "";
      document.documentElement.style.minWidth = "";
      document.documentElement.style.height = "";
      if (document.body) {
        document.body.style.overflow = "";
        document.body.style.transform = "";
        document.body.style.transformOrigin = "";
        document.body.style.width = "";
        document.body.style.minWidth = "";
      }
    }

    window.__viewProxyFocusState = null;
    window.__viewProxyFocusBox = null;
    return { ok: true };
  };

  window.__viewProxyFocusIsActive = function () {
    return !!window.__viewProxyFocusState;
  };

  /** Measure window chrome for true-size outer sizing */
  window.__viewProxyFocusMeasure = function measure() {
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      dpr: window.devicePixelRatio || 1,
      box: window.__viewProxyFocusBox || null
    };
  };
})();
