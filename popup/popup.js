/**
 * ViewProxy control panel (persistent window — does not die on page click).
 */
const statusEl = document.getElementById("status");
const targetEl = document.getElementById("target");

init();

async function init() {
  refreshTarget();
  setInterval(refreshTarget, 2000);

  document.getElementById("btn-select").addEventListener("click", () => {
    run({ action: "page-region" }, "Opening select on target tab…");
  });
  document.getElementById("btn-stop").addEventListener("click", () => {
    run({ action: "stop" }, "Stopping…");
  });
  document.getElementById("btn-video").addEventListener("click", () => {
    run({ action: "freeform" }, "Video crop…");
  });
}

async function refreshTarget() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "get-target-info" });
    if (res?.ok && res.tabId) {
      targetEl.textContent = "Target: " + (res.title || "tab").slice(0, 48);
      targetEl.title = res.url || "";
    } else {
      targetEl.textContent = "Target: (click ViewProxy on a page first)";
    }
  } catch {
    targetEl.textContent = "Target: …";
  }
}

function setStatus(msg, ok) {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("err", ok === false);
}

async function run(payload, pending) {
  setStatus(pending || "Working…", true);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "run-on-active-tab",
      payload
    });
    if (!res?.ok) {
      setStatus(res?.error || "Failed.", false);
      return;
    }
    setStatus(res.hint || "Done.", true);
  } catch (err) {
    setStatus(String(err?.message || err), false);
  }
}
