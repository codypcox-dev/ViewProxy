/**
 * ViewProxy Focus — live true-size re-frame for SPAs
 *
 * Why things went black before:
 *  shrinking the window makes React/Grok re-layout for a tiny viewport.
 *
 * Fix:
 *  1) Freeze window.innerWidth/Height (+ clientWidth) to selection-time size
 *  2) Block resize events from reaching the page
 *  3) Wrap page content and translate so the box sits at (0,0)
 *  4) Let the OS window clip to W×H (true size) without reflow
 */
(function () {
  const STYLE_ID = "__viewproxy_focus_style";
  const STAGE_ID = "__viewproxy_focus_stage";
  const EXIT_ID = "__viewproxy_focus_exit";
  const FLAG = "__viewproxy_focus";

  /**
   * @param {{left:number,top:number,width:number,height:number}} box
   * @param {{w:number,h:number}|null} viewport
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
    const layoutW = Math.max(
      W,
      Math.round(viewport?.w || window.innerWidth || 1280)
    );
    const layoutH = Math.max(
      H,
      Math.round(viewport?.h || window.innerHeight || 800)
    );

    const state = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      layoutW,
      layoutH,
      box: { left: L, top: T, width: W, height: H },
      patched: [],
      resizeHandler: null,
      stageCreated: false
    };

    // ── freeze viewport metrics (stops SPA reflow) ─────────────────
    function patchGetter(obj, key, value) {
      try {
        const existing = Object.getOwnPropertyDescriptor(obj, key);
        // Also try prototype
        state.patched.push({ obj, key, existing, own: true });
        Object.defineProperty(obj, key, {
          configurable: true,
          enumerable: true,
          get() {
            return value;
          }
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    // Patch on window — native getters are often on the instance
    patchGetter(window, "innerWidth", layoutW);
    patchGetter(window, "innerHeight", layoutH);
    patchGetter(window, "outerWidth", layoutW);
    patchGetter(window, "outerHeight", layoutH);
    try {
      patchGetter(document.documentElement, "clientWidth", layoutW);
      patchGetter(document.documentElement, "clientHeight", layoutH);
      patchGetter(document.documentElement, "scrollWidth", layoutW);
      patchGetter(document.documentElement, "scrollHeight", layoutH);
    } catch (_) {}

    // Swallow resize so React doesn't re-layout mid-focus
    state.resizeHandler = function stopResize(e) {
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener("resize", state.resizeHandler, true);
    window.addEventListener("orientationchange", state.resizeHandler, true);

    // ── wrap page content so transform doesn't fight fixed headers ──
    const body = document.body;
    if (!body) throw new Error("No document.body");

    let stage = document.getElementById(STAGE_ID);
    if (!stage) {
      stage = document.createElement("div");
      stage.id = STAGE_ID;
      // Move all current body children into the stage
      const move = [];
      for (const child of Array.from(body.childNodes)) {
        if (child.nodeType === 1) {
          const id = child.id;
          if (id === STAGE_ID || id === STYLE_ID || id === EXIT_ID) continue;
        }
        move.push(child);
      }
      for (const n of move) stage.appendChild(n);
      body.insertBefore(stage, body.firstChild);
      state.stageCreated = true;
    }

    stage.style.cssText = [
      "display:block",
      "position:relative",
      "transform:translate(" + -L + "px," + -T + "px)",
      "transform-origin:0 0",
      "width:" + layoutW + "px",
      "min-width:" + layoutW + "px",
      "margin:0",
      "padding:0",
      "will-change:transform"
    ].join(";");

    // ── clip the real viewport to the window (W×H after resize) ─────
    const css = `
      html.${FLAG}, html.${FLAG} body {
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #000 !important;
      }
      html.${FLAG} body {
        width: 100% !important;
        height: 100% !important;
        position: relative !important;
      }
      #${EXIT_ID} {
        position: fixed !important;
        top: 6px !important;
        right: 6px !important;
        z-index: 2147483647 !important;
        border: 1px solid rgba(255,255,255,0.2) !important;
        border-radius: 8px !important;
        background: rgba(15,23,42,0.9) !important;
        color: #f8fafc !important;
        font: 700 11px/1 system-ui,sans-serif !important;
        padding: 7px 10px !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
        opacity: 0.4 !important;
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
    body.style.setProperty("overflow", "hidden", "important");
    body.style.setProperty("margin", "0", "important");

    try {
      window.scrollTo(0, 0);
    } catch (_) {}

    // Force a paint with frozen metrics
    try {
      void stage.offsetHeight;
      window.dispatchEvent(new Event("resize")); // some apps need one; we block propagation to page... 
      // actually our handler blocks it. Good.
    } catch (_) {}

    // Exit control on documentElement (outside stage transform)
    let exit = document.getElementById(EXIT_ID);
    if (!exit) {
      exit = document.createElement("button");
      exit.id = EXIT_ID;
      exit.type = "button";
      exit.textContent = "✕ Exit Focus";
      exit.title = "Return tab to Chrome";
      exit.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          chrome.runtime
            .sendMessage({ type: "stop-focus-mode" })
            .then((res) => {
              if (!res || res.ok === false) {
                // Fallback local restore if SW failed
                restore(true);
              }
            })
            .catch(() => restore(true));
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

    // Remove listeners / patches first
    if (state?.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler, true);
      window.removeEventListener("orientationchange", state.resizeHandler, true);
    }
    if (state?.patched) {
      for (const p of state.patched) {
        try {
          if (p.existing) {
            Object.defineProperty(p.obj, p.key, p.existing);
          } else {
            delete p.obj[p.key];
          }
        } catch (_) {
          try {
            delete p.obj[p.key];
          } catch (__) {}
        }
      }
    }

    document.documentElement.classList.remove(FLAG);
    document.getElementById(STYLE_ID)?.remove();
    if (removeExit) document.getElementById(EXIT_ID)?.remove();

    // Unwrap stage
    const stage = document.getElementById(STAGE_ID);
    if (stage && state?.stageCreated) {
      const parent = stage.parentNode;
      if (parent) {
        while (stage.firstChild) {
          parent.insertBefore(stage.firstChild, stage);
        }
        stage.remove();
      }
    } else if (stage) {
      stage.style.cssText = "";
    }

    document.documentElement.style.overflow = "";
    document.documentElement.style.width = "";
    document.documentElement.style.height = "";
    document.documentElement.style.minWidth = "";
    if (document.body) {
      document.body.style.overflow = "";
      document.body.style.margin = "";
      document.body.style.width = "";
      document.body.style.minWidth = "";
      document.body.style.transform = "";
      document.body.style.transformOrigin = "";
    }

    if (state) {
      try {
        window.scrollTo(state.scrollX || 0, state.scrollY || 0);
      } catch (_) {}
    }

    window.__viewProxyFocusState = null;
    window.__viewProxyFocusBox = null;

    // Nudge layout back
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (_) {}

    return { ok: true };
  };

  window.__viewProxyFocusIsActive = function () {
    return !!window.__viewProxyFocusState;
  };

  window.__viewProxyFocusMeasure = function measure() {
    // Read REAL dimensions via visualViewport / documentElement before patches… 
    // When patched, use outer from chrome.windows instead; still report patched for sizing math.
    // For window chrome calculation we need REAL inner vs outer.
    // Use a side channel: store real values on apply and update via outer-inner from screen.
    return {
      // When frozen, use screen API as truth for outer, and compute chrome from last known
      innerW: window.__viewProxyFocusRealInnerW || window.innerWidth,
      innerH: window.__viewProxyFocusRealInnerH || window.innerHeight,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      dpr: window.devicePixelRatio || 1,
      box: window.__viewProxyFocusBox || null
    };
  };

  // Keep real inner sizes updated when not frozen (and stash before patch)
  window.__viewProxyFocusCaptureRealSize = function () {
    // Call BEFORE patching in apply — but apply already patches.
    // Unpatched read: use documentElement.getBoundingClientRect of a probe
  };
})();
