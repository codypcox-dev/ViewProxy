# ViewProxy

**Select a pixel-exact region of any webpage and either stream it or live-focus it.**

Private, local-only Chrome/Edge extension. No network, no analytics, no remote code.

## Modes

| Mode | What it does | Interactive? | Best for |
|---|---|---|---|
| **Watch** | True-size pixel crop → full-bleed proxy window | No (read-only) | Monitoring |
| **Attract** | Freezes page layout metrics in the **page main world**, translates the box to `(0,0)`, reshapes the **real tab window** to W×H | **Yes** (real DOM) | Live widgets; “drag the browser to the box” |

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

## How Attract works

Manual “drag the Chrome edges around the widget” feels right but SPAs reflow when `innerWidth` changes.

Attract does that **without** the reflow:

1. Record box + viewport size at selection time  
2. Inject into the **page main world** (where React runs) and freeze `innerWidth` / `innerHeight` to the old viewport  
3. Wrap page content and `translate(-left, -top)` so the box sits at the origin  
4. Move the tab into a tight popup and set outer size so the **client area is the box**  
5. Exit restores freezes, unwraps the DOM, and puts the tab back in a normal Chrome window  

**Limits:** OS title bar remains. Some sites ignore freezes or use workers for layout. Not every fixed-position shell will look perfect.

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
