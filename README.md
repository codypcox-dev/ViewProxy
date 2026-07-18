# ViewProxy

**Select any pixel-exact region of a webpage and stream it into a full-bleed proxy window.**

Private, local-only Chrome/Edge extension. No network, no analytics, no remote code.

## Why

Browser extensions cannot “just stream a DOM node.” ViewProxy does the simple, reliable thing:

1. You draw a box (CSS pixels)
2. The extension screenshots the tab
3. It crops **exactly** that box
4. A small proxy window shows only those pixels, full-bleed, updating ~8 fps

Works for dashboards, timers, widgets, usage meters — anything painted on the page.

## Install (unpacked)

1. Clone this repo  
2. Open `chrome://extensions` (or `edge://extensions`)  
3. Enable **Developer mode**  
4. **Load unpacked** → select the `ViewProxy` folder  
5. Pin the extension  

## Use

1. Open the page you want to watch  
2. Click the **ViewProxy** icon  
3. Drag a yellow box (the page is locked — no click-through)  
4. Click **Stream box** (or press Enter)  
5. A proxy window opens at that exact size  

### Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Shift+R` | Select region |
| `Alt+Shift+S` | Stop stream |
| `Alt+Shift+C` | Crop a `<video>` into native PiP |

Right-click the extension icon for the same actions + control panel.

## Privacy

Permissions used:

| Permission | Why |
|---|---|
| `activeTab` | Access only the tab you invoke on |
| `scripting` | Inject the selector when you click |
| `storage` | Remember last box size (local only) |
| `contextMenus` | Right-click menu on the icon |

No `tabs` host scrape by default. No identity APIs. No beacons. No CDNs.

## How it works

```
[active tab]
    │  user draws box (content/select.js)
    │  hide overlay
    ▼
captureVisibleTab (background)
    │
    ▼
cropToBox() in content script  ← same coordinates as the yellow box
    │
    ▼
exact-frame message
    │
    ▼
[proxy window] player/proxy.html  full-bleed <img>
```

**Note:** The source tab must stay open. While the source tab is not the visible tab in its window, `captureVisibleTab` may freeze or capture the wrong surface. Keep the dashboard tab open in a window (it can be in the background of that window in many cases, but “visible tab” capture is a browser limit).

## Optional: video crop

`Alt+Shift+C` or the control panel **Crop video** path uses a canvas crop of a page `<video>` into native Picture-in-Picture. Separate from the page-region proxy.

## License

Apache-2.0. See `LICENSE`.

Inspired by the idea behind [Crop PiP](https://github.com/JKH-ML/Crop-PiP) (Apache-2.0); ViewProxy is a clean-room local tool focused on exact page-region streaming.
