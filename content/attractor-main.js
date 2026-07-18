/**
 * ViewProxy Attractor — MAIN world (where React reads window.innerWidth).
 *
 * 1) Freeze layout metrics to selection-time viewport (no SPA reflow)
 * 2) Translate so the yellow box sits at (0,0)
 * 3) After the OS window is resized to ~box size, scale the stage so that
 *    box W×H fluidly FILLS the real client area (true-size, no “zoom in” corner)
 */
(function () {
  if (window.__viewProxyAttractor && window.__viewProxyAttractor.version >= 2) {
    return;
  }

  const STYLE_ID = "__viewproxy_attr_style";
  const STAGE_ID = "__viewproxy_attr_stage";
  const EXIT_ID = "__viewproxy_attr_exit";
  const FLAG = "__viewproxy_attr";

  const api = {
    version: 2,
    state: null,

    /**
     * @param {{left:number,top:number,width:number,height:number}} box
     * @param {{w:number,h:number}} viewport
     */
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

      // Page JS (React) keeps thinking the viewport is the original size
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

      // Rightmost transform applies first: translate box to origin, then scale to fill
      function applyStageTransform(sx, sy) {
        stage.style.cssText = [
          "display:block",
          "position:relative",
          "box-sizing:border-box",
          // scale AFTER translate in matrix terms → write scale then translate in CSS
          "transform:scale(" + sx + "," + sy + ") translate(" + -L + "px," + -T + "px)",
          "transform-origin:0 0",
          "width:" + layoutW + "px",
          "min-width:" + layoutW + "px",
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
          opacity: 0.4 !important;
          transition: opacity .15s ease !important;
          pointer-events: auto !important;
        }
        #${EXIT_ID}:hover {
          opacity: 1 !important;
          background: rgba(127,29,29,.95) !important;
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
            window.postMessage({ source: "viewproxy", type: "exit-focus" }, "*");
          },
          true
        );
        document.documentElement.appendChild(exit);
      }

      api.state = state;
      return { ok: true, box: { left: L, top: T, width: W, height: H }, layoutW, layoutH };
    },

    /**
     * After the OS window is resized, scale the selected box to FILL the real client area.
     * realW/realH must be measured from the ISOLATED world (unpatched) or windows API.
     * mode: "fill" stretch | "contain" letterbox | "cover" crop-to-fill
     */
    setFill(realW, realH, mode) {
      const state = api.state;
      if (!state || !state.applyStageTransform) return { ok: false };

      realW = Math.max(1, Number(realW) || 1);
      realH = Math.max(1, Number(realH) || 1);
      const W = state.W;
      const H = state.H;
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
      // "fill" keeps independent sx, sy — stretches to exact client

      state.fillScaleX = sx;
      state.fillScaleY = sy;
      state.applyStageTransform(sx, sy);
      return { ok: true, sx, sy, realW, realH, W, H };
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
