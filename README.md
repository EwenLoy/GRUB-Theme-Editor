# GRUB Theme Editor by ewenloy

**English** | [Русский](README.ru.md)

A visual (WYSIWYG) editor for GRUB boot menu themes. Runs entirely in your browser — no installs, no build, no server. Open `index.html` and start drawing.

![License](https://img.shields.io/badge/license-GPL--3.0-blue) ![Vanilla JS](https://img.shields.io/badge/vanilla-JS-yellow) ![No build](https://img.shields.io/badge/build-none-success)

<!-- TODO: add a screenshot / GIF of the editor and the real GRUB result here:
![editor screenshot](docs/screenshot.png) -->

## Features

- **Draw your theme on a canvas** — boot menu, progress bar, circular progress, labels, images, rectangles. Drag & drop, zoom, a properties panel, canvas presets from 640×480 up to 1920×1080.
- **Honest 9-slice borders.** GRUB only accepts borders as a set of separate files `name_nw.png … name_se.png` — the editor gives you exactly those 9 slots, not a fake single-image stretch.
- **GRUB-safe PNG export.** Any image is converted to PNG, and every PNG is re-encoded into a deflate stream GRUB's own (buggy) PNG decoder can actually read — no more `error: invalid filter value.` on real hardware. (See the [PNG decoder quirk](#notes) below.)
- **OS icons library built in** (80+ distros/tools), auto-matched to `--class` — with aliases like `macos` → `macosx` covered.
- **Live preview** with a countdown, approximating real GRUB behavior (hidden after keypress, etc.).
- **Import & export.** Import existing themes from a folder, ZIP, TAR or TAR.GZ; export `theme.txt` or a full ZIP with a grub.cfg snippet.
- **Project file** (JSON) to save/load your work; custom `.pf2` fonts.
- **UI languages**: English and Russian, switchable with one click (`lang/*.json` — easy to add more).

## What it is NOT

- The preview is an approximation — always test the final theme in QEMU or on real hardware.
- It doesn't edit `grub.cfg`: the menu entries and timeout come from your system, the editor only draws the look.
- OS icons are bound via `--class` in your `grub.cfg` (the editor tells you the class for each entry).

## Quick start

1. Open `index.html` in any modern browser (or use the hosted version — *add link when GitHub Pages is on*).
2. Right-click the canvas to insert elements; edit properties on the right.
3. **File → Save project** regularly (JSON file).
4. **Export ZIP** → put the theme folder into `/boot/grub/themes/your-theme/`, then in `/etc/default/grub` add:
   ```sh
   GRUB_THEME=/boot/grub/themes/your-theme/theme.txt
   ```
   and run `sudo update-grub`.

## User guide

### Top bar
- **File** — New project, Open project (`.json`), Save project, Import theme (folder / ZIP / TAR / TAR.GZ with a `theme.txt` inside).
- **View** — zoom, fit-to-screen, snapping/grid toggles.
- **Canvas settings…** — canvas presets (640×480 … 1920×1080) and the background picture of the theme (`background.png` in the export).
- **EN / RU** — interface language.
- **▶ Preview** — animated countdown preview (progress bar fills, circular ticks appear/disappear, hidden after a keypress, like real GRUB).
- **Export ZIP / Export theme.txt** — see [Export](#export) below.

### Canvas
- **Right-click** anywhere → insert a layer (Boot menu, Progress bar, Circular progress, Label, Image, Rectangle).
- Drag to move, handles to resize; arrow keys for 1-px nudges. Selected layer is highlighted and listed in the **Layers** panel (top-right) where you can reorder, hide, lock or delete it.

### Properties panel (left) — per layer type
- **Boot menu** — position/size, font + size, item colors, selected item colors, `max_items_shown`, `item_height`, `item_padding`, `item_spacing`, `item_icon_space`, icon size, icons on/off, scrollbar options. Borders are honest **9-slice**: 9 separate slots (`_nw/_n/_ne/_w/_c/_e/_sw/_s/_se`) for `item_pixmap_style` and `selected_item_pixmap_style`. Without a picture GRUB draws no background at all — the editor shows the same.
- **Progress bar** — `id="__timeout__"` checkbox, fill/background colors, `show_text` + text template (`%d` = seconds left, plain text otherwise), bar/highlight 9-slice images, highlight overlay mode.
- **Circular progress** — `id="__timeout__"`, `num_ticks`, `start_angle` (units: 256 = full circle, −64 = 12 o'clock, the GRUB default), `ticks_disappear`. **Requires two images** or it is invisible in real GRUB: `center_bitmap` (centered, natural size) and `tick_bitmap` (one tick, stamped around the circle, natural size, never scaled or rotated).
- **Label** — text (with GRUB variables like `@TIMEOUT@`), font, size, bold, color, alignment.
- **Image** — a single PNG, stretched to the layer bounds.
- **Rectangle** — fill + border color only (decorative; GRUB `rect` component).

> Every field writes exactly what real GRUB reads. If GRUB cannot do something, the editor says so instead of faking it.

### Project configuration (OS icons) — bottom left
One row per menu entry: **title, `--class`, icon**. Icons come from the built-in library (80+ distros, auto-matched from `--class`, aliases covered) or your own PNG. Buttons to import all preset icons into the theme or clear them.

### Fonts
GRUB only understands **`.pf2`** bitmap fonts. Upload your `.pf2` files in the menu layer (or via the project tree) — the editor warns when a rendered size has no real `.pf2` behind it (GRUB would fall back to its tiny built-in font). Any `.ttf/.otf` you add to the project is auto-converted to `.pf2` on export.

### Import
File → Import accepts a folder, `.zip`, `.tar`, `.tar.gz` with a `theme.txt`. All components, images and fonts are parsed back into editable layers.

### Export
- **Export theme.txt** — just the theme file (paths point to `assets/…`).
- **Export ZIP** — the complete theme folder: `theme.txt`, `background.png`, all PNGs (re-encoded GRUB-safe), fonts, plus a ready `grub.cfg` snippet. Unzip into `/boot/grub/themes/your-theme/`, add `GRUB_THEME=…` to `/etc/default/grub`, run `sudo update-grub`.

## Notes


- **The PNG decoder quirk.** GRUB ships its own tiny PNG/inflate implementation whose Huffman-table construction breaks on some perfectly valid PNGs (e.g. ones produced by browsers or ImageMagick), failing with `error: invalid filter value.` and "Press any key to continue…". The editor transparently re-encodes every PNG on export into a GRUB-safe deflate stream, so themes built with it just work.
- No undo/redo yet. Save often.

## Contributing

Issues and PRs are welcome — bug reports with a failing theme archive are especially useful.
To add a UI language: drop `lang/<code>.json` (same format as `lang/en.json`), run `node build-lang.js`, done.

## License

[GPL-3.0](LICENSE)
