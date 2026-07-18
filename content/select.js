/**
 * ViewProxy — region select + exact sample loop
 *
 * 1. Full-screen hit layer (page cannot receive clicks)
 * 2. User draws CSS-pixel box
 * 3. Overlay hidden → captureVisibleTab → crop exact box → proxy window
 */
(function () {
  const VERSION = 1;
  const ROOT_ID = "__viewproxy_root";
  const TOAST_ID = "__viewproxy_toast";
  const YELLOW = "#facc15";

  let cleanup = null;
  let streamTimer = 0;
  let streaming = false;
  let streamBusy = false;

  window.__viewProxyVersion = VERSION;
  window.__viewProxyHandle = function handle(p) {
    if (!p?.action) return;
    if (p.action === "region" || p.action === "element") startSelect();
    else if (p.action === "cancel") destroyUi();
    else if (p.action === "stop" || p.action === "follow-stop") stopStream();
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "viewproxy-stop") stopStream();
  });

  function toast(msg, ms = 3500) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_ID;
      el.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;" +
        "background:rgba(15,23,42,.96);color:#f8fafc;padding:10px 14px;border-radius:10px;" +
        "font:600 13px/1.35 system-ui,sans-serif;pointer-events:none;max-width:min(92vw,520px);" +
        "text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.4)";
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.remove(), ms);
  }

  function destroyUi() {
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch (_) {}
    }
    cleanup = null;
    document.getElementById(ROOT_ID)?.remove();
  }

  function startSelect() {
    destroyUi();
    stopStream(false);

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;user-select:none;" +
      "-webkit-user-select:none;touch-action:none;background:rgba(2,6,23,0.45);" +
      "font-family:system-ui,sans-serif";

    const sel = document.createElement("div");
    sel.style.cssText =
      "position:fixed;display:none;box-sizing:border-box;border:2px solid " +
      YELLOW +
      ";background:rgba(250,204,21,0.15);pointer-events:none;z-index:1";
    root.appendChild(sel);

    const tag = document.createElement("div");
    tag.style.cssText =
      "position:fixed;display:none;pointer-events:none;z-index:2;background:" +
      YELLOW +
      ";color:#0f172a;font:700 11px/1 system-ui,sans-serif;padding:4px 6px;border-radius:4px";
    root.appendChild(tag);

    const bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:3;display:flex;" +
      "gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;" +
      "background:rgba(15,23,42,0.97);color:#e2e8f0;padding:10px 12px;border-radius:12px;" +
      "border:1px solid " +
      YELLOW +
      ";max-width:calc(100vw - 24px);pointer-events:auto";
    bar.innerHTML =
      '<span style="font:700 13px system-ui;color:' +
      YELLOW +
      '">ViewProxy — drag a box (page locked)</span>' +
      '<button type="button" data-act="go" disabled style="border:none;border-radius:8px;background:' +
      YELLOW +
      ';color:#0f172a;font:700 12px system-ui;padding:8px 12px;cursor:pointer;opacity:0.45">Stream box</button>' +
      '<button type="button" data-act="cancel" style="border:none;border-radius:8px;background:#fca5a5;color:#0f172a;font:700 12px system-ui;padding:8px 12px;cursor:pointer">Cancel</button>';
    root.appendChild(bar);
    document.documentElement.appendChild(root);

    let dragging = false;
    let x0 = 0;
    let y0 = 0;
    /** @type {{left:number,top:number,width:number,height:number}|null} */
    let box = null;
    const goBtn = bar.querySelector('[data-act="go"]');

    function setBox(left, top, width, height) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let L = Math.max(0, Math.min(left, vw));
      let T = Math.max(0, Math.min(top, vh));
      let W = Math.max(0, width);
      let H = Math.max(0, height);
      if (L + W > vw) W = vw - L;
      if (T + H > vh) H = vh - T;

      box = { left: L, top: T, width: W, height: H };
      sel.style.display = "block";
      sel.style.left = L + "px";
      sel.style.top = T + "px";
      sel.style.width = W + "px";
      sel.style.height = H + "px";
      tag.style.display = "block";
      tag.textContent = Math.round(W) + " × " + Math.round(H) + " px";
      tag.style.left = L + "px";
      tag.style.top = Math.max(0, T - 22) + "px";
      const ok = W >= 8 && H >= 8;
      goBtn.disabled = !ok;
      goBtn.style.opacity = ok ? "1" : "0.45";
      goBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }

    function isBar(el) {
      return el && (el === bar || bar.contains(el));
    }

    function onPointerDown(e) {
      if (isBar(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.button !== 0) return;
      dragging = true;
      x0 = e.clientX;
      y0 = e.clientY;
      try {
        root.setPointerCapture(e.pointerId);
      } catch (_) {}
      setBox(x0, y0, 0, 0);
    }

    function onPointerMove(e) {
      if (isBar(e.target) && !dragging) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!dragging) return;
      setBox(
        Math.min(x0, e.clientX),
        Math.min(y0, e.clientY),
        Math.abs(e.clientX - x0),
        Math.abs(e.clientY - y0)
      );
    }

    function onPointerUp(e) {
      if (isBar(e.target) && !dragging) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!dragging) return;
      dragging = false;
      try {
        root.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    const sink = (e) => {
      if (isBar(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("pointermove", onPointerMove, true);
    root.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("pointercancel", onPointerUp, true);
    for (const t of [
      "mousedown",
      "mouseup",
      "click",
      "dblclick",
      "contextmenu",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend"
    ]) {
      root.addEventListener(t, sink, true);
    }

    bar.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        const act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
        if (act === "cancel") destroyUi();
        if (act === "go") launch();
      },
      true
    );

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        destroyUi();
      } else if (e.key === "Enter" && box && box.width >= 8 && box.height >= 8) {
        e.preventDefault();
        e.stopPropagation();
        launch();
      }
    }
    window.addEventListener("keydown", onKey, true);

    async function launch() {
      if (!box || box.width < 8 || box.height < 8) {
        toast("Drag a larger box first");
        return;
      }
      const frozen = {
        left: Math.round(box.left),
        top: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
      const viewport = { w: window.innerWidth, h: window.innerHeight };

      root.style.visibility = "hidden";
      root.style.pointerEvents = "none";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      try {
        const opened = await chrome.runtime.sendMessage({
          type: "start-exact-stream",
          pixelBox: frozen,
          viewport
        });
        if (!opened?.ok) {
          destroyUi();
          toast(opened?.error || "Failed to open proxy");
          return;
        }
        destroyUi();
        toast("ViewProxy " + frozen.width + "×" + frozen.height + " px");
        startSampleLoop(frozen, viewport);
      } catch (err) {
        destroyUi();
        toast(String(err && err.message ? err.message : err));
      }
    }

    cleanup = () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("pointermove", onPointerMove, true);
      root.removeEventListener("pointerup", onPointerUp, true);
      root.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("keydown", onKey, true);
      root.remove();
    };

    toast("ViewProxy v" + VERSION + " · drag the box · page is locked");
  }

  function stopStream(closeProxy = true) {
    streaming = false;
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = 0;
    streamBusy = false;
    if (closeProxy) {
      chrome.runtime.sendMessage({ type: "stop-exact-stream" }).catch(() => {});
    }
  }

  function startSampleLoop(box, viewport) {
    streaming = true;
    streamBusy = false;

    const tick = async () => {
      if (!streaming) return;
      if (!streamBusy) {
        streamBusy = true;
        try {
          const res = await chrome.runtime.sendMessage({ type: "capture-visible-tab" });
          if (res?.ok && res.dataUrl) {
            const cropped = await cropToBox(res.dataUrl, box, viewport);
            if (cropped) {
              await chrome.runtime.sendMessage({
                type: "exact-frame",
                dataUrl: cropped,
                w: box.width,
                h: box.height
              });
            }
          }
        } catch (_) {
          // one-frame failure is fine
        } finally {
          streamBusy = false;
        }
      }
      if (streaming) streamTimer = setTimeout(tick, 120);
    };
    tick();
  }

  function cropToBox(dataUrl, box, viewport) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const iw = img.naturalWidth;
          const ih = img.naturalHeight;
          if (!iw || !ih) return resolve(null);

          const scaleX = iw / viewport.w;
          const scaleY = ih / viewport.h;

          let sx = box.left * scaleX;
          let sy = box.top * scaleY;
          let sw = box.width * scaleX;
          let sh = box.height * scaleY;

          sx = Math.max(0, Math.min(sx, iw - 1));
          sy = Math.max(0, Math.min(sy, ih - 1));
          sw = Math.max(1, Math.min(sw, iw - sx));
          sh = Math.max(1, Math.min(sh, ih - sy));

          const canvas = document.createElement("canvas");
          canvas.width = box.width;
          canvas.height = box.height;
          const ctx = canvas.getContext("2d", { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, box.width, box.height);
          resolve(canvas.toDataURL("image/jpeg", 0.92));
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
})();
