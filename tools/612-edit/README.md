# 612 Edit

A free, fully local thumbnail and photo editor that runs in the browser. Nothing is uploaded. No accounts, no cloud models, no Electron install.

Built as a comparison to [LTW EzEdit](https://github.com/Eli-Dolney/LTW_EzEdit): same job (YouTube thumbnails, social sizes, photo tweaks), different architecture.

## Why this vs EzEdit

| | LTW EzEdit | 612 Edit |
|---|---|---|
| Runtime | Electron + Webpack | Vite, any browser |
| Layers | Raster-heavy canvas | Object layers (text/shapes stay editable) |
| Zoom | Known centering drift | Zoom toward the cursor |
| Background removal | Panel in the Electron app | Local color/flood cutout, no remote model |
| Fonts | System fonts | Bundled OFL display fonts (Anton, Archivo Black, Bebas Neue, Oswald, Inter) |
| Cost | Free | Free |

## Run

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Open http://localhost:5174. For a static build:

```bash
npm run build
npm run preview
```

## Thumbnail workflow

1. Pick a template from the gallery (Home, or **Templates** in the editor).
2. Drop a screenshot onto a PHOTO well — it lands as its own layer.
3. Use **Type** for big outlined titles (the styles that actually get clicks).
4. **Make** for arrows, circles, and badges.
5. Toggle **Safe** for a 5% YouTube title-safe overlay.
6. **Export** as PNG / JPEG / WebP, or one-click to platform sizes.

## Template gallery

40+ layouts with live canvas previews, grouped and searchable:

- **YouTube** — face+title, yellow pop, listicle, vs, before/after, reaction, review score, cinematic, finance, sports
- **Gaming** — clutch, stream starting, victory, rank-up
- **Tutorial** — how-to, terminal, 3 steps
- **Podcast / News** — lower-thirds, breaking ticker, two hosts
- **Instagram / Stories / Shorts** — quote, tip carousel, product, countdown, vertical hook
- **X / LinkedIn / Banners** — announcement, thread, stat, channel art, headers

Photo wells are placeholders. After you apply a template, drop a file onto the canvas.

## Photo workflow

1. **Open photo** — canvas matches the image.
2. **Photo** tab: brightness, contrast, saturation, hue, warmth, blur, vignette, and named filters.
3. **Wand (W)** to punch out a background by color. Raise tolerance or enable “remove everywhere” for chroma-style cutouts.
4. Export PNG to keep transparency.

## Shortcuts

| Key | Action |
|---|---|
| V / H / T / B / E / R / O / I / W | Select, pan, text, brush, eraser, rect, ellipse, eyedropper, wand |
| Space-drag | Pan |
| Wheel | Zoom to cursor |
| ⌘/Ctrl Z | Undo |
| ⌘/Ctrl Shift Z | Redo |
| ⌘/Ctrl S | Save `.grokedit.json` project |
| ⌘/Ctrl E | Export |
| ⌘/Ctrl 0 | Fit |
| Delete | Delete layer |
| ⌘/Ctrl D | Duplicate layer |

Projects are JSON with embedded data URLs. Keep them local; large photos make large files.

## Stack

React 19, TypeScript, Vite, HTML Canvas, Lucide icons, Fontsource. MIT-licensed fonts only. No analytics.
