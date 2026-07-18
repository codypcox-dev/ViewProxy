# ViewProxy

**Select a pixel-exact region of any webpage and either stream it or live-focus it.**

Private, local-only Chrome/Edge extension. No network, no analytics, no remote code.

## Modes

| Mode | What it does | Interactive? | Best for |
|---|---|---|---|
| **Watch** | Screenshots + crops the box into a full-bleed proxy window | No (read-only) | Monitoring meters, dashboards |
| **Focus** | Re-frames the **real tab** to that box in a tight popup | **Yes** | Clicking/typing in a widget while it stays “live” |

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

1. Measure your CSS-pixel box  
2. Inject a transform/clip so that box sits at `(0,0)` with overflow hidden  
3. Move the tab into a `popup` window and resize to the box  
4. The page keeps running as a normal tab (JS, websockets, React)  
5. Exit restores styles and moves the tab back  

**Limits:** Chrome still shows a small OS title bar on popup windows. Some sites with heavy `position: fixed` shells can look off. Minimized windows may still be throttled by Chrome — better than screenshots, not magic.

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
