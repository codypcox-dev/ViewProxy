/**
 * ViewProxy Attractor — MAIN world
 *
 * Universal viewport centering (one rule):
 *   scale = realW / cropW          (width-flush: never leave L/R)
 *   crop center  →  viewport center
 *   matrix(s, 0, 0, s, tx, ty) with
 *     tx = realW/2 - s * (L + W/2)
 *     ty = realH/2 - s * (T + H/2)
 *
 * Resize:
 *   L/R edges → scale only (L/W fixed); center holds
 *   T/B edges → crop T/H in page space; then re-center
 *   pure move → no-op
 */
(function () {
  const STYLE_ID = "__viewproxy_attr_style";
  const STAGE_ID = "__viewproxy_attr_stage";
  const EXIT_ID = "__viewproxy_attr_exit";
  const FLAG = "__viewproxy_attr";

  // Preserve live session if script is re-injected mid-attract
  const prevState = window.__viewProxyAttractor && window.__viewProxyAttractor.state;

  const api = {
    version: 7,
    state: prevState || null,

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
        scale: 1,
        lastRealW: W,
        lastRealH: H,
        cropResize: true,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        patches: [],
        resizeStop: null,
        scrollLock: null,
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

      // Freeze layout metrics so React/layout still see the original page size
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

      state.resizeStop = function (e) {
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      window.addEventListener("resize", state.resizeStop, true);
      window.addEventListener("orientationchange", state.resizeStop, true);

      state.scrollLock = function () {
        try {
          if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
        } catch (_) {}
      };
      window.addEventListener("scroll", state.scrollLock, true);

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
      state.stageEl = stage;

      /**
       * ONE paint path. Always maps crop center → viewport center.
       * Width-flush: s = realW/W so crop left→0 and crop right→realW.
       */
      function paint() {
        const s = api.state || state;
        const stageEl = s.stageEl || document.getElementById(STAGE_ID);
        if (!stageEl) return;

        const realW = Math.max(1, s.lastRealW || s.W);
        const realH = Math.max(1, s.lastRealH || s.H);
        const W = Math.max(1, s.W);
        const H = Math.max(1, s.H);
        const scale = realW / W;

        const cropCx = s.L + W / 2;
        const cropCy = s.T + H / 2;
        const viewCx = realW / 2;
        const viewCy = realH / 2;
        const tx = viewCx - scale * cropCx;
        const ty = viewCy - scale * cropCy;

        s.scale = scale;

        // Single matrix — no stacked translate/scale origin games
        stageEl.style.cssText = [
          "display:block",
          "position:fixed",
          "left:0",
          "top:0",
          "right:auto",
          "bottom:auto",
          "box-sizing:border-box",
          "margin:0",
          "padding:0",
          "border:0",
          "width:" + s.layoutW + "px",
          "height:" + s.layoutH + "px",
          "transform:matrix(" + scale + ",0,0," + scale + "," + tx + "," + ty + ")",
          "transform-origin:0 0",
          "overflow:visible",
          "will-change:transform",
          "z-index:0",
          "pointer-events:auto"
        ].join(";");
      }
      state.paint = paint;
      paint();

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
          width: 100% !important;
          height: 100% !important;
          max-width: 100% !important;
          max-height: 100% !important;
        }
        html.${FLAG} {
          position: fixed !important;
          inset: 0 !important;
        }
        html.${FLAG} body {
          position: fixed !important;
          inset: 0 !important;
        }
        #${EXIT_ID} {
          position: fixed !important;
          left: 50% !important;
          bottom: 10px !important;
          transform: translateX(-50%) !important;
          z-index: 2147483647 !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          min-width: 220px !important;
          max-width: calc(100% - 16px) !important;
          border: 1px solid rgba(250,204,21,0.5) !important;
          border-radius: 12px !important;
          background: rgba(15,23,42,0.95) !important;
          color: #f8fafc !important;
          padding: 10px 12px !important;
          box-shadow: 0 8px 28px rgba(0,0,0,0.45) !important;
          pointer-events: auto !important;
        }
        #${EXIT_ID} button[data-act="exit"] {
          all: unset !important;
          box-sizing: border-box !important;
          display: block !important;
          width: 100% !important;
          text-align: center !important;
          cursor: pointer !important;
          background: #facc15 !important;
          color: #0f172a !important;
          font: 800 13px/1.2 system-ui,sans-serif !important;
          padding: 10px 12px !important;
          border-radius: 8px !important;
        }
        #${EXIT_ID} button[data-act="exit"]:hover {
          filter: brightness(1.06) !important;
        }
        #${EXIT_ID} .vp-row {
          display: flex !important;
          gap: 10px !important;
          align-items: center !important;
          justify-content: center !important;
          font: 600 11px/1.2 system-ui,sans-serif !important;
          color: #e2e8f0 !important;
        }
        #${EXIT_ID} label {
          display: flex !important;
          gap: 6px !important;
          align-items: center !important;
          cursor: pointer !important;
          user-select: none !important;
        }
      `;

      document.documentElement.classList.add(FLAG);
      document.documentElement.style.setProperty("overflow", "hidden", "important");
      body.style.setProperty("overflow", "hidden", "important");
      body.style.setProperty("margin", "0", "important");

      try {
        window.scrollTo(0, 0);
      } catch (_) {}

      document.getElementById(EXIT_ID)?.remove();
      const exit = document.createElement("div");
      exit.id = EXIT_ID;
      exit.innerHTML =
        '<button type="button" data-act="exit">↩ Return to Chrome tab</button>' +
        '<div class="vp-row">' +
        '<label><input type="checkbox" data-act="crop" checked /> Crop edges (top/bottom)</label>' +
        "</div>";

      exit.addEventListener(
        "click",
        (e) => {
          const t = e.target;
          const act =
            (t && t.getAttribute && t.getAttribute("data-act")) ||
            (t &&
              t.closest &&
              t.closest("[data-act]") &&
              t.closest("[data-act]").getAttribute("data-act"));
          if (act === "exit") {
            e.preventDefault();
            e.stopPropagation();
            window.postMessage({ source: "viewproxy", type: "exit-focus" }, "*");
            try {
              document.documentElement.setAttribute("data-viewproxy-exit", String(Date.now()));
            } catch (_) {}
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

      api.state = state;
      return {
        ok: true,
        box: { left: L, top: T, width: W, height: H },
        layoutW,
        layoutH,
        cropResize: true
      };
    },

    /**
     * Re-bind the stage to the true client viewport.
     * Always centers crop on viewport; always width-flush.
     */
    setFill(realW, realH) {
      const state = api.state;
      if (!state || !state.paint) return { ok: false };

      state.lastRealW = Math.max(1, Number(realW) || 1);
      state.lastRealH = Math.max(1, Number(realH) || 1);
      state.paint();

      const scale = state.scale;
      return {
        ok: true,
        scale,
        realW: state.lastRealW,
        realH: state.lastRealH,
        W: state.W,
        H: state.H,
        L: state.L,
        T: state.T,
        // debug: where crop center lands
        cropCx: state.L + state.W / 2,
        cropCy: state.T + state.H / 2,
        viewCx: state.lastRealW / 2,
        viewCy: state.lastRealH / 2
      };
    },

    /**
     * Apply crop delta already converted to PAGE pixels (not window DIPs).
     * Horizontal crop is never applied (L/W stay fixed).
     */
    applyCropPageDelta(dT, dH) {
      const state = api.state;
      if (!state) return { ok: false };
      if (!state.cropResize) {
        return { ok: true, cropResize: false, box: api.getBox() };
      }
      if (!dT && !dH) {
        return { ok: true, cropResize: true, box: api.getBox(), scaleOnly: true };
      }

      let T = state.T + (Number(dT) || 0);
      let H = state.H + (Number(dH) || 0);

      const MIN = 40;
      if (H < MIN) {
        if ((Number(dT) || 0) > 0) T -= MIN - H;
        H = MIN;
      }
      T = Math.max(0, Math.min(T, state.layoutH - MIN));
      H = Math.max(MIN, Math.min(H, state.layoutH - T));

      state.T = Math.round(T);
      state.H = Math.round(H);
      // L, W never change
      state.paint();

      return { ok: true, cropResize: true, box: api.getBox(), scaleOnly: false };
    },

    /**
     * Legacy window-DIP path (kept for safety). Prefer applyCropPageDelta.
     * Horizontal size changes → scale only. Vertical → page crop via /scale.
     */
    applyBoundsDelta(dLeft, dTop, dWidth, dHeight) {
      const state = api.state;
      if (!state) return { ok: false };

      if (dWidth === 0 && dHeight === 0) {
        return {
          ok: true,
          cropResize: !!state.cropResize,
          box: api.getBox(),
          scaleOnly: true,
          moved: true
        };
      }

      if (!state.cropResize || dHeight === 0) {
        return { ok: true, cropResize: !!state.cropResize, box: api.getBox(), scaleOnly: true };
      }

      // Convert outer DIPs → page pixels using current scale
      const s = Math.max(0.0001, state.scale || 1);
      return api.applyCropPageDelta(dTop / s, dHeight / s);
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
      if (state.scrollLock) {
        window.removeEventListener("scroll", state.scrollLock, true);
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
      document.documentElement.style.position = "";
      document.documentElement.style.inset = "";
      if (document.body) {
        document.body.style.overflow = "";
        document.body.style.margin = "";
        document.body.style.position = "";
        document.body.style.inset = "";
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
