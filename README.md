# ViewProxy

**Select a pixel-exact region of any webpage and either stream it or live-focus it.**

Private, local-only Chrome/Edge extension. No network, no analytics, no remote code.

## Modes

| Mode | What it does | Interactive? | Best for |
|---|---|---|---|
| **Watch** | True-size pixel crop → full-bleed proxy | No (read-only) | Monitoring meters, dashboards |
| **Focus** | Same true-size stream **+** clicks/keys relayed into the live source tab | **Yes** | Interacting while the real tab stays fully running |

## Install (unpacked)

1. Clone: `https://github.com/codypcox-dev/ViewProxy`
2. `chrome://extensions` → **Developer mode** → **Load unpacked**
3. Select the `ViewProxy` folder

## Use

1. Open the page you care about  
2. Click the **ViewProxy** icon  
3. Drag a yellow box (page clicks are blocked while selecting)  
4. Choose:
   - **Watch** — read-only pixel proxy  
   - **Focus (live)** — real tab clipped to the box  
5. **Enter** after drawing defaults to **Focus**  
6. In Focus mode, use **✕ Exit Focus** (top-right) or **Alt+Shift+S** to restore  

### Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+R` | Select region |
| `Alt+Shift+S` | Stop Watch / Focus |
| `Alt+Shift+C` | Crop a `<video>` into native PiP |

## How Focus works

CSS re-frame of SPAs (Grok, etc.) went black — they reflow when the window shrinks.

Focus instead uses the **same true-size Watch pipeline**, then:

1. Source tab stays full-size in Chrome (always live)  
2. Proxy shows the exact pixel box (1:1, full-bleed)  
3. Clicks / wheel / keys in the proxy are **relayed** into the source tab at mapped coordinates  
4. **✕ Exit Focus** closes the proxy and **focuses the source tab in Chrome**  

**Limits:** Source tab should stay open (and ideally still the active tab in its window) for fresh captures. Synthetic events don’t cover every site interaction (canvas games, etc.).

## How Watch works

```
draw box → hide overlay → captureVisibleTab → crop exact pixels → proxy <img>
```

Source tab should stay open. Visible-tab capture is a browser constraint.

## Privacy

| Permission | Why |
|---|---|
| `activeTab` | Only the tab you invoke |
| `scripting` | Inject select / focus helpers |
| `storage` | Last box size (local) |
| `contextMenus` | Icon menu |

## License

Apache-2.0 — see `LICENSE`.
