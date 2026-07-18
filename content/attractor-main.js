/**
 * ViewProxy Attractor — MAIN world
 *
 * Layout rules (user spec):
 *  - Content NEVER leaves left/right of the viewport (always width-flush)
 *  - Content stays vertically centered
 *  - Left/right window edges → scale (zoom) toward center; crop L/W unchanged
 *  - Top/bottom window edges → crop (consume/reveal content); T/H change
 */
(function () {
  const STYLE_ID = "__viewproxy_attr_style";
  const STAGE_ID = "__viewproxy_attr_stage";
  const EXIT_ID = "__viewproxy_attr_exit";
  const FLAG = "__viewproxy_attr";

  const api = {
    version: 5,
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
        centerX: 0,
        centerY: 0,
        cropResize: true,
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

      /**
       * Rightmost first: translate crop→origin, scale (width-driven), then vertical center.
       * Horizontal: always flush L/R (cx = 0 when sx = realW/W).
       */
      function applyStageTransform(sx, sy, cx, cy) {
        const s = api.state || state;
        cx = cx != null ? cx : 0;
        cy = cy != null ? cy : s.centerY || 0;
        stage.style.cssText = [
          "display:block",
          "position:relative",
          "box-sizing:border-box",
          "transform:translate(" +
            cx +
            "px," +
            cy +
            "px) scale(" +
            sx +
            "," +
            sy +
            ") translate(" +
            -s.L +
            "px," +
            -s.T +
            "px)",
          "transform-origin:0 0",
          "width:" + s.layoutW + "px",
          "min-width:" + s.layoutW + "px",
          "margin:0",
          "padding:0",
          "will-change:transform"
        ].join(";");
      }
      state.applyStageTransform = applyStageTransform;
      applyStageTransform(1, 1, 0, 0);

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
            (t && t.closest && t.closest("[data-act]") && t.closest("[data-act]").getAttribute("data-act"));
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
     * Width-flush + vertical center:
     *   sx = sy = realW / W   (always touch left & right)
     *   cx = 0
     *   cy = (realH - H*sy) / 2
     */
    setFill(realW, realH) {
      const state = api.state;
      if (!state || !state.applyStageTransform) return { ok: false };

      realW = Math.max(1, Number(realW) || 1);
      realH = Math.max(1, Number(realH) || 1);
      const W = Math.max(1, state.W);
      const H = Math.max(1, state.H);

      // Never leave left/right: scale uniformly by WIDTH
      const s = realW / W;
      const sx = s;
      const sy = s;
      const cx = 0;
      // Fluid vertical center
      const cy = (realH - H * sy) / 2;

      state.fillScaleX = sx;
      state.fillScaleY = sy;
      state.centerX = cx;
      state.centerY = cy;
      state.applyStageTransform(sx, sy, cx, cy);
      return { ok: true, sx, sy, cx, cy, realW, realH, W, H, L: state.L, T: state.T };
    },

    /**
     * Window bounds deltas (chrome.windows DIP).
     *
     * Left/right: do NOT change L/W — only window size changes → setFill scales toward center.
     * Top/bottom: crop T/H (top edge consumes top content, bottom consumes bottom).
     */
    applyBoundsDelta(dLeft, dTop, dWidth, dHeight) {
      const state = api.state;
      if (!state) return { ok: false };

      // Horizontal resize → scale only (caller will setFill). Keep crop L/W fixed
      // unless cropResize is off entirely.
      const horizontalOnly =
        dTop === 0 && dHeight === 0 && (dLeft !== 0 || dWidth !== 0);

      if (!state.cropResize) {
        return { ok: true, cropResize: false, box: api.getBox(), scaleOnly: true };
      }

      if (horizontalOnly) {
        // L/R edges: scale toward center via setFill only
        return { ok: true, cropResize: true, box: api.getBox(), scaleOnly: true };
      }

      // Vertical (and diagonal): apply top/bottom crop. Ignore horizontal crop of L/W
      // so left/right never "eat" horizontal content — only scale.
      let T = state.T + dTop;
      let H = state.H + dHeight;

      // If diagonal, still only vertical crop; width stays
      const MIN = 40;
      if (H < MIN) {
        if (dTop > 0) T -= MIN - H;
        H = MIN;
      }
      T = Math.max(0, Math.min(T, state.layoutH - MIN));
      H = Math.max(MIN, Math.min(H, state.layoutH - T));

      state.T = Math.round(T);
      state.H = Math.round(H);
      // L, W unchanged — horizontal flush preserved

      state.applyStageTransform(
        state.fillScaleX || 1,
        state.fillScaleY || 1,
        0,
        state.centerY || 0
      );

      return {
        ok: true,
        cropResize: true,
        box: api.getBox(),
        scaleOnly: false
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
