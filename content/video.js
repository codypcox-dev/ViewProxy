/**
 * ViewProxy — content script (injected only when you ask)
 * Handles freeform crop overlay + cropped Picture-in-Picture via canvas.
 * Nothing leaves the page. No fetches. No beacons.
 */
(function () {
  if (window.__viewProxyVideoLoaded) return;
  window.__viewProxyVideoLoaded = true;

  const OVERLAY_ID = "__viewproxy_overlay";
  const TOAST_ID = "__viewproxy_toast";
  let activeCleanup = null;
  let pipSession = null;

  window.__viewProxyVideoHandle = function handle(payload) {
    if (!payload || !payload.action) return;

    if (payload.action === "freeform") {
      startFreeformCrop();
      return;
    }
    if (payload.action === "pip") {
      const rect = normalizeRect(payload.rect);
      runCroppedPiP(rect);
      return;
    }
    if (payload.action === "cancel") {
      teardownOverlay();
    }
  };

  function normalizeRect(rect) {
    if (!rect || typeof rect !== "object") {
      return { x: 0, y: 0, w: 1, h: 1 };
    }
    let x = clamp(Number(rect.x) || 0, 0, 1);
    let y = clamp(Number(rect.y) || 0, 0, 1);
    let w = clamp(Number(rect.w) || 1, 0.01, 1);
    let h = clamp(Number(rect.h) || 1, 0.01, 1);
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    return { x, y, w, h };
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function findVideos() {
    return Array.from(document.querySelectorAll("video"))
      .filter((v) => v.readyState !== 0)
      .filter((v) => v.disablePictureInPicture !== true)
      .map((v) => {
        const r = v.getBoundingClientRect();
        return { video: v, area: Math.max(0, r.width) * Math.max(0, r.height), rect: r };
      })
      .filter((x) => x.area > 0)
      .sort((a, b) => b.area - a.area);
  }

  function findLargestPlayingVideo() {
    const list = findVideos();
    return list.length ? list[0].video : null;
  }

  function toast(message, ms = 2400) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_ID;
      el.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:28px",
        "transform:translateX(-50%)",
        "z-index:2147483647",
        "background:rgba(15,23,42,.92)",
        "color:#f8fafc",
        "padding:10px 16px",
        "border-radius:10px",
        "font:600 13px/1.4 system-ui,-apple-system,sans-serif",
        "box-shadow:0 8px 30px rgba(0,0,0,.35)",
        "pointer-events:none",
        "max-width:min(90vw,420px)",
        "text-align:center"
      ].join(";");
      document.documentElement.appendChild(el);
    }
    el.textContent = message;
    el.style.opacity = "1";
    clearTimeout(el.__hideTimer);
    el.__hideTimer = setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  function teardownOverlay() {
    if (typeof activeCleanup === "function") {
      try {
        activeCleanup();
      } catch (_) {}
    }
    activeCleanup = null;
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function startFreeformCrop() {
    teardownOverlay();

    const candidates = findVideos();
    if (!candidates.length) {
      toast("No usable <video> found on this page.");
      return;
    }

    const target = candidates[0];
    const video = target.video;

    // Prefer playing / largest visible video
    if (video.paused) {
      video.play().catch(() => {});
    }

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.setAttribute("data-crop-pip-local", "1");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      fontFamily: "system-ui,-apple-system,sans-serif",
      userSelect: "none"
    });

    const dim = document.createElement("div");
    Object.assign(dim.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(2,6,23,.45)"
    });
    root.appendChild(dim);

    const frame = document.createElement("div");
    Object.assign(frame.style, {
      position: "absolute",
      boxShadow: "0 0 0 9999px rgba(2,6,23,.45)",
      outline: "2px solid #3b82f6",
      background: "transparent",
      pointerEvents: "none"
    });
    root.appendChild(frame);

    const sel = document.createElement("div");
    Object.assign(sel.style, {
      position: "absolute",
      border: "2px solid #60a5fa",
      background: "rgba(59,130,246,.18)",
      display: "none",
      pointerEvents: "none",
      boxSizing: "border-box"
    });
    root.appendChild(sel);

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      gap: "8px",
      alignItems: "center",
      background: "rgba(15,23,42,.94)",
      color: "#e2e8f0",
      padding: "10px 12px",
      borderRadius: "12px",
      boxShadow: "0 10px 40px rgba(0,0,0,.4)",
      zIndex: "1",
      maxWidth: "calc(100vw - 24px)",
      flexWrap: "wrap",
      justifyContent: "center"
    });
    bar.innerHTML = `
      <span style="font-size:13px;font-weight:600;white-space:nowrap">
        Drag on the video to crop · Esc cancel
      </span>
      <button type="button" data-act="full" style="${btnStyle("#334155")}">Full video</button>
      <button type="button" data-act="center" style="${btnStyle("#334155")}">Center</button>
      <button type="button" data-act="pip" style="${btnStyle("#2563eb")}" disabled>Start PiP</button>
      <button type="button" data-act="cancel" style="${btnStyle("#7f1d1d")}">Cancel</button>
    `;
    root.appendChild(bar);

    document.documentElement.appendChild(root);

    let videoBox = getVideoContentBox(video);
    positionFrame(frame, videoBox);

    let drag = null;
    let cropNorm = null; // relative to video content box 0..1
    const pipBtn = bar.querySelector('[data-act="pip"]');

    function refreshBox() {
      videoBox = getVideoContentBox(video);
      positionFrame(frame, videoBox);
      if (cropNorm) paintSelection(sel, videoBox, cropNorm);
    }

    const onResize = () => refreshBox();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    function setCrop(norm) {
      cropNorm = normalizeRect(norm);
      paintSelection(sel, videoBox, cropNorm);
      sel.style.display = "block";
      pipBtn.disabled = false;
      pipBtn.style.opacity = "1";
    }

    bar.addEventListener("click", (e) => {
      const act = e.target?.getAttribute?.("data-act");
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      if (act === "cancel") {
        teardownOverlay();
        return;
      }
      if (act === "full") {
        setCrop({ x: 0, y: 0, w: 1, h: 1 });
        return;
      }
      if (act === "center") {
        setCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
        return;
      }
      if (act === "pip" && cropNorm) {
        const rect = { ...cropNorm };
        try {
          chrome.runtime.sendMessage({ type: "save-rect", rect });
        } catch (_) {}
        teardownOverlay();
        runCroppedPiP(rect, video);
      }
    });

    function onPointerDown(e) {
      if (e.button !== 0) return;
      if (e.target.closest("button")) return;
      const p = clientToVideoNorm(e.clientX, e.clientY, videoBox);
      if (!p) return;
      e.preventDefault();
      drag = { x0: p.x, y0: p.y };
      sel.style.display = "block";
      pipBtn.disabled = true;
      pipBtn.style.opacity = "0.5";
    }

    function onPointerMove(e) {
      if (!drag) return;
      const p = clientToVideoNorm(e.clientX, e.clientY, videoBox, true);
      const x = Math.min(drag.x0, p.x);
      const y = Math.min(drag.y0, p.y);
      const w = Math.abs(p.x - drag.x0);
      const h = Math.abs(p.y - drag.y0);
      paintSelection(sel, videoBox, { x, y, w: Math.max(w, 0.01), h: Math.max(h, 0.01) });
    }

    function onPointerUp(e) {
      if (!drag) return;
      const p = clientToVideoNorm(e.clientX, e.clientY, videoBox, true);
      const x = Math.min(drag.x0, p.x);
      const y = Math.min(drag.y0, p.y);
      let w = Math.abs(p.x - drag.x0);
      let h = Math.abs(p.y - drag.y0);
      drag = null;
      // Tiny click = ignore / keep previous
      if (w < 0.02 && h < 0.02) {
        if (!cropNorm) sel.style.display = "none";
        return;
      }
      setCrop({ x, y, w: Math.max(w, 0.02), h: Math.max(h, 0.02) });
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        teardownOverlay();
      } else if (e.key === "Enter" && cropNorm) {
        e.preventDefault();
        const rect = { ...cropNorm };
        try {
          chrome.runtime.sendMessage({ type: "save-rect", rect });
        } catch (_) {}
        teardownOverlay();
        runCroppedPiP(rect, video);
      }
    }

    root.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKey, true);

    activeCleanup = () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKey, true);
      root.remove();
    };
  }

  function btnStyle(bg) {
    return [
      "border:none",
      "border-radius:8px",
      `background:${bg}`,
      "color:#f8fafc",
      "font:600 12px system-ui,-apple-system,sans-serif",
      "padding:8px 10px",
      "cursor:pointer",
      "opacity:1"
    ].join(";");
  }

  /**
   * Video content box accounting for object-fit: contain letterboxing.
   */
  function getVideoContentBox(video) {
    const br = video.getBoundingClientRect();
    const vw = video.videoWidth || br.width;
    const vh = video.videoHeight || br.height;
    if (!vw || !vh || !br.width || !br.height) {
      return { left: br.left, top: br.top, width: br.width, height: br.height };
    }
    const videoRatio = vw / vh;
    const elRatio = br.width / br.height;
    let width = br.width;
    let height = br.height;
    let left = br.left;
    let top = br.top;
    // Most players use contain-like behavior for the painted frame
    if (elRatio > videoRatio) {
      width = br.height * videoRatio;
      left = br.left + (br.width - width) / 2;
    } else if (elRatio < videoRatio) {
      height = br.width / videoRatio;
      top = br.top + (br.height - height) / 2;
    }
    return { left, top, width, height };
  }

  function positionFrame(frame, box) {
    frame.style.left = `${box.left}px`;
    frame.style.top = `${box.top}px`;
    frame.style.width = `${box.width}px`;
    frame.style.height = `${box.height}px`;
  }

  function paintSelection(sel, box, norm) {
    sel.style.left = `${box.left + norm.x * box.width}px`;
    sel.style.top = `${box.top + norm.y * box.height}px`;
    sel.style.width = `${norm.w * box.width}px`;
    sel.style.height = `${norm.h * box.height}px`;
  }

  function clientToVideoNorm(cx, cy, box, clampToBox = false) {
    let x = (cx - box.left) / box.width;
    let y = (cy - box.top) / box.height;
    if (!clampToBox && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }

  async function runCroppedPiP(cropRect, sourceVideo) {
    const video = sourceVideo || findLargestPlayingVideo();
    if (!video) {
      toast("No usable <video> found on this page.");
      return;
    }

    cropRect = normalizeRect(cropRect);

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture().catch(() => {});
      }
      endPipSession();

      // Full frame → native PiP (keeps original quality + audio path in PiP)
      if (cropRect.w >= 0.999 && cropRect.h >= 0.999 && cropRect.x <= 0.001 && cropRect.y <= 0.001) {
        if (video.paused) await video.play().catch(() => {});
        await video.requestPictureInPicture();
        toast("PiP: full video");
        return;
      }

      await requestCroppedPictureInPicture(video, cropRect);
      toast("Cropped PiP started (source tab keeps audio)");
    } catch (err) {
      console.error("[ViewProxy]", err);
      toast(`PiP failed: ${err?.message || err}`);
      try {
        await video.requestPictureInPicture();
      } catch (_) {}
    }
  }

  async function requestCroppedPictureInPicture(sourceVideo, cropRect) {
    if (!sourceVideo.videoWidth) {
      return sourceVideo.requestPictureInPicture();
    }

    if (sourceVideo.paused) {
      await sourceVideo.play().catch(() => {});
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    const outputVideo = document.createElement("video");
    outputVideo.muted = true;
    outputVideo.autoplay = true;
    outputVideo.playsInline = true;
    outputVideo.setAttribute("playsinline", "");
    // Keep off-DOM but in document for some browsers
    Object.assign(outputVideo.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      left: "-10px",
      top: "-10px"
    });
    document.documentElement.appendChild(outputVideo);

    const sw = sourceVideo.videoWidth;
    const sh = sourceVideo.videoHeight;
    const cropX = cropRect.x * sw;
    const cropY = cropRect.y * sh;
    const cropW = Math.max(2, cropRect.w * sw);
    const cropH = Math.max(2, cropRect.h * sh);

    // Cap canvas size for performance while keeping aspect
    const maxEdge = 1920;
    let outW = Math.round(cropW);
    let outH = Math.round(cropH);
    if (outW > maxEdge || outH > maxEdge) {
      const scale = maxEdge / Math.max(outW, outH);
      outW = Math.max(2, Math.round(outW * scale));
      outH = Math.max(2, Math.round(outH * scale));
    }
    canvas.width = outW;
    canvas.height = outH;

    ctx.drawImage(sourceVideo, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

    const stream = canvas.captureStream(30);
    outputVideo.srcObject = stream;
    await outputVideo.play();
    await outputVideo.requestPictureInPicture();

    let animationId = 0;
    let running = true;

    const render = () => {
      if (!running) return;
      if (document.pictureInPictureElement === outputVideo) {
        try {
          ctx.drawImage(sourceVideo, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
        } catch (_) {
          // source may be lost mid-stream
        }
        animationId = requestAnimationFrame(render);
      } else {
        running = false;
      }
    };
    animationId = requestAnimationFrame(render);

    const onLeave = () => {
      running = false;
      if (animationId) cancelAnimationFrame(animationId);
      stream.getTracks().forEach((t) => t.stop());
      outputVideo.srcObject = null;
      outputVideo.remove();
      canvas.width = 0;
      canvas.height = 0;
      pipSession = null;
    };

    outputVideo.addEventListener("leavepictureinpicture", onLeave, { once: true });

    pipSession = {
      end: () => {
        running = false;
        if (animationId) cancelAnimationFrame(animationId);
        if (document.pictureInPictureElement === outputVideo) {
          document.exitPictureInPicture().catch(() => {});
        }
        onLeave();
      }
    };
  }

  function endPipSession() {
    if (pipSession) {
      try {
        pipSession.end();
      } catch (_) {}
      pipSession = null;
    }
  }
})();

