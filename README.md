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

## Notes

- **The PNG decoder quirk.** GRUB ships its own tiny PNG/inflate implementation whose Huffman-table construction breaks on some perfectly valid PNGs (e.g. ones produced by browsers or ImageMagick), failing with `error: invalid filter value.` and "Press any key to continue…". The editor transparently re-encodes every PNG on export into a GRUB-safe deflate stream, so themes built with it just work.
- No undo/redo yet. Save often.

## Contributing

Issues and PRs are welcome — bug reports with a failing theme archive are especially useful.
To add a UI language: drop `lang/<code>.json` (same format as `lang/en.json`), run `node build-lang.js`, done.

## License

[GPL-3.0](LICENSE)
