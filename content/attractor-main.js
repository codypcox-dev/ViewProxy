/**
 * ViewProxy Attractor — MAIN world
 *
 * - Freeze SPA viewport metrics (React sees original layout size)
 * - Translate selected box to (0,0)
 * - Scale box to fill real client area
 * - Crop-resize: window edge drags update L/T/W/H so TOP behaves like BOTTOM
 *   (edges "consume" content instead of pushing it)
 */
(function () {
  // Always reinstall API (versioned) so extension reloads apply
  const STYLE_ID = "__viewproxy_attr_style";
  const STAGE_ID = "__viewproxy_attr_stage";
  const EXIT_ID = "__viewproxy_attr_exit";
  const FLAG = "__viewproxy_attr";

  const api = {
    version: 3,
    state: null,

    apply(box, viewport) {
      if (api.state) api.restore({ keepExit: true });

      const L = Math.round(box.left);
      const T = Math.round(box.top);
      const W = Math.max(1, Math.round(box.width));
      const H = Math.max(1, Math.round(box.height));
      const layoutW = Math.max(W, Math.round(viewport?.w || window.innerWidth || 1280));
      const layoutH = Math.max(H, Math.round(viewport?.h || window.innerHeight || 800));

      const state = {
        L,
        T,
        W,
        H,
        layoutW,
        layoutH,
        fillScaleX: 1,
        fillScaleY: 1,
        cropResize: true, // default: edges act as crop tools
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        patches: [],
        resizeStop: null,
        stageCreated: false,
        meta: null,
        metaCreated: false
      };

      function patch(obj, key, value) {
        try {
          let desc = null;
          try {
            desc = Object.getOwnPropertyDescriptor(obj, key) || null;
          } catch (_) {}
          state.patches.push({ obj, key, desc });
          Object.defineProperty(obj, key, {
            configurable: true,
            enumerable: true,
            get() {
              return value;
            }
          });
        } catch (_) {}
      }

      patch(window, "innerWidth", layoutW);
      patch(window, "innerHeight", layoutH);
      patch(window, "outerWidth", layoutW);
      patch(window, "outerHeight", layoutH);
      try {
        patch(document.documentElement, "clientWidth", layoutW);
        patch(document.documentElement, "clientHeight", layoutH);
      } catch (_) {}
      try {
        if (window.visualViewport) {
          patch(window.visualViewport, "width", layoutW);
          patch(window.visualViewport, "height", layoutH);
          patch(window.visualViewport, "offsetLeft", 0);
          patch(window.visualViewport, "offsetTop", 0);
          patch(window.visualViewport, "scale", 1);
        }
      } catch (_) {}

      // Swallow resize so SPA doesn't reflow — crop-resize is handled by the extension
      state.resizeStop = function (e) {
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      window.addEventListener("resize", state.resizeStop, true);
      window.addEventListener("orientationchange", state.resizeStop, true);

      let meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        state.meta = meta.getAttribute("content");
        meta.setAttribute(
          "content",
          "width=" + layoutW + ", initial-scale=1, maximum-scale=1, user-scalable=no"
        );
      } else {
        meta = document.createElement("meta");
        meta.name = "viewport";
        meta.content =
          "width=" + layoutW + ", initial-scale=1, maximum-scale=1, user-scalable=no";
        meta.setAttribute("data-viewproxy", "1");
        (document.head || document.documentElement).appendChild(meta);
        state.metaCreated = true;
      }

      const body = document.body;
      if (!body) throw new Error("No body");

      let stage = document.getElementById(STAGE_ID);
      if (!stage) {
        stage = document.createElement("div");
        stage.id = STAGE_ID;
        const move = [];
        for (const child of Array.from(body.childNodes)) {
          if (child.nodeType === 1) {
            const id = child.id;
            if (id === STAGE_ID || id === STYLE_ID || id === EXIT_ID) continue;
          }
          move.push(child);
        }
        for (const n of move) stage.appendChild(n);
        body.appendChild(stage);
        state.stageCreated = true;
      }

      function applyStageTransform(sx, sy) {
        const s = api.state || state;
        // CSS: rightmost applied first → translate to origin, then scale to fill client
        stage.style.cssText = [
          "display:block",
          "position:relative",
          "box-sizing:border-box",
          "transform:scale(" + sx + "," + sy + ") translate(" + -s.L + "px," + -s.T + "px)",
          "transform-origin:0 0",
          "width:" + s.layoutW + "px",
          "min-width:" + s.layoutW + "px",
          "margin:0",
          "padding:0",
          "will-change:transform"
        ].join(";");
      }
      state.applyStageTransform = applyStageTransform;
      applyStageTransform(1, 1);

      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.documentElement.appendChild(style);
      }
      style.textContent = `
        html.${FLAG}, html.${FLAG} body {
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #0a0a0a !important;
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
          border: 1px solid rgba(255,255,255,.2) !important;
          border-radius: 8px !important;
          background: rgba(15,23,42,.92) !important;
          color: #f8fafc !important;
          font: 700 11px/1 system-ui,sans-serif !important;
          padding: 7px 10px !important;
          cursor: pointer !important;
          opacity: 0.35 !important;
          transition: opacity .15s ease !important;
          pointer-events: auto !important;
        }
        #${EXIT_ID}:hover {
          opacity: 1 !important;
          background: rgba(127,29,29,.95) !important;
        }
        #${EXIT_ID} .vp-toggle {
          display: block;
          margin-top: 6px;
          font: 600 10px/1.2 system-ui,sans-serif;
          opacity: 0.9;
          white-space: nowrap;
        }
      `;

      document.documentElement.classList.add(FLAG);
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      body.style.setProperty("overflow", "hidden", "important");
      body.style.setProperty("margin", "0", "important");

      try {
        window.scrollTo(0, 0);
      } catch (_) {}

      let exit = document.getElementById(EXIT_ID);
      if (!exit) {
        exit = document.createElement("div");
        exit.id = EXIT_ID;
        exit.innerHTML =
          '<button type="button" data-act="exit" style="all:unset;cursor:pointer;display:block;width:100%">✕ Exit Focus</button>' +
          '<label class="vp-toggle"><input type="checkbox" data-act="crop" checked /> Crop edges</label>';
        exit.addEventListener(
          "click",
          (e) => {
            const act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
            if (act === "exit" || e.target.closest?.('[data-act="exit"]')) {
              e.preventDefault();
              e.stopPropagation();
              window.postMessage({ source: "viewproxy", type: "exit-focus" }, "*");
            }
          },
          true
        );
        exit.addEventListener(
          "change",
          (e) => {
            const t = e.target;
            if (t && t.getAttribute && t.getAttribute("data-act") === "crop") {
              if (api.state) api.state.cropResize = !!t.checked;
              window.postMessage(
                { source: "viewproxy", type: "crop-resize-toggle", enabled: !!t.checked },
                "*"
              );
            }
          },
          true
        );
        document.documentElement.appendChild(exit);
      }

      api.state = state;
      return {
        ok: true,
        box: { left: L, top: T, width: W, height: H },
        layoutW,
        layoutH,
        cropResize: true
      };
    },

    setFill(realW, realH, mode) {
      const state = api.state;
      if (!state || !state.applyStageTransform) return { ok: false };

      realW = Math.max(1, Number(realW) || 1);
      realH = Math.max(1, Number(realH) || 1);
      const W = Math.max(1, state.W);
      const H = Math.max(1, state.H);
      mode = mode || "fill";

      let sx = realW / W;
      let sy = realH / H;
      if (mode === "contain") {
        const s = Math.min(sx, sy);
        sx = s;
        sy = s;
      } else if (mode === "cover") {
        const s = Math.max(sx, sy);
        sx = s;
        sy = s;
      }

      state.fillScaleX = sx;
      state.fillScaleY = sy;
      state.applyStageTransform(sx, sy);
      return { ok: true, sx, sy, realW, realH, W, H, L: state.L, T: state.T };
    },

    /**
     * Crop-resize from window bounds deltas (CSS/DIP pixels from chrome.windows).
     *
     * Windows default: top-left of client is content origin.
     * Dragging TOP down moves the window and keeps content top-anchored → "pushes" content.
     * We instead treat every edge as a crop edge:
     *   dLeft/dTop shift the content origin (L/T)
     *   dWidth/dHeight change visible size (W/H)
     *
     * So top-down ≡ consume top (like bottom-up consumes bottom).
     */
    applyBoundsDelta(dLeft, dTop, dWidth, dHeight) {
      const state = api.state;
      if (!state) return { ok: false };

      if (!state.cropResize) {
        // Normal Windows behavior: only size changes; origin stays (top-left anchor)
        // W/H track client via setFill only
        return { ok: true, cropResize: false, box: api.getBox() };
      }

      // Expand/shrink visible region in layout coordinates (1 DIP ≈ 1 CSS px)
      let L = state.L + dLeft;
      let T = state.T + dTop;
      let W = state.W + dWidth;
      let H = state.H + dHeight;

      // Minimum crop size
      const MIN = 40;
      if (W < MIN) {
        // If shrinking from left, push L back
        if (dLeft > 0) L -= MIN - W;
        W = MIN;
      }
      if (H < MIN) {
        if (dTop > 0) T -= MIN - H;
        H = MIN;
      }

      // Clamp to layout
      L = Math.max(0, Math.min(L, state.layoutW - MIN));
      T = Math.max(0, Math.min(T, state.layoutH - MIN));
      W = Math.max(MIN, Math.min(W, state.layoutW - L));
      H = Math.max(MIN, Math.min(H, state.layoutH - T));

      state.L = Math.round(L);
      state.T = Math.round(T);
      state.W = Math.round(W);
      state.H = Math.round(H);

      // Re-apply transform with current fill scale
      state.applyStageTransform(state.fillScaleX || 1, state.fillScaleY || 1);

      return {
        ok: true,
        cropResize: true,
        box: api.getBox()
      };
    },

    setCropResize(enabled) {
      if (!api.state) return { ok: false };
      api.state.cropResize = !!enabled;
      return { ok: true, cropResize: api.state.cropResize };
    },

    getBox() {
      const s = api.state;
      if (!s) return null;
      return { left: s.L, top: s.T, width: s.W, height: s.H };
    },

    getState() {
      const s = api.state;
      if (!s) return null;
      return {
        box: api.getBox(),
        layoutW: s.layoutW,
        layoutH: s.layoutH,
        cropResize: s.cropResize,
        fillScaleX: s.fillScaleX,
        fillScaleY: s.fillScaleY
      };
    },

    restore(opts) {
      const keepExit = opts && opts.keepExit;
      const state = api.state;
      if (!state) {
        document.getElementById(STYLE_ID)?.remove();
        if (!keepExit) document.getElementById(EXIT_ID)?.remove();
        document.documentElement.classList.remove(FLAG);
        return { ok: true };
      }

      if (state.resizeStop) {
        window.removeEventListener("resize", state.resizeStop, true);
        window.removeEventListener("orientationchange", state.resizeStop, true);
      }

      for (const p of state.patches) {
        try {
          if (p.desc) Object.defineProperty(p.obj, p.key, p.desc);
          else delete p.obj[p.key];
        } catch (_) {
          try {
            delete p.obj[p.key];
          } catch (__) {}
        }
      }

      if (state.metaCreated) {
        document.querySelector('meta[name="viewport"][data-viewproxy="1"]')?.remove();
      } else if (state.meta != null) {
        const m = document.querySelector('meta[name="viewport"]');
        if (m) m.setAttribute("content", state.meta);
      }

      document.getElementById(STYLE_ID)?.remove();
      if (!keepExit) document.getElementById(EXIT_ID)?.remove();
      document.documentElement.classList.remove(FLAG);
      document.documentElement.style.overflow = "";
      if (document.body) {
        document.body.style.overflow = "";
        document.body.style.margin = "";
      }

      const stage = document.getElementById(STAGE_ID);
      if (stage && state.stageCreated) {
        const parent = stage.parentNode;
        if (parent) {
          while (stage.firstChild) parent.insertBefore(stage.firstChild, stage);
          stage.remove();
        }
      } else if (stage) {
        stage.removeAttribute("style");
      }

      try {
        window.scrollTo(state.scrollX || 0, state.scrollY || 0);
      } catch (_) {}

      api.state = null;
      try {
        window.dispatchEvent(new Event("resize"));
      } catch (_) {}
      return { ok: true };
    },

    isActive() {
      return !!api.state;
    }
  };

  window.__viewProxyAttractor = api;
})();
