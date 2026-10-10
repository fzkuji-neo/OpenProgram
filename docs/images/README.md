# Image Sources

This directory keeps the editable image sources used by documentation and the WebUI. Runtime copies live under `apps/web/` and end up in the static export (`apps/web/out/`) the worker serves.

## App Icon

The mark is an indigo tile holding a lavender cell with three flat discs. The
[App icon specification](../reference/design/ui/app-icon.html) defines its
geometry, colours and every output.

Canonical sources:

- `docs/images/openprogram-app-icon.svg`: the flat macOS tile on the Big Sur grid
  (824 px squircle at offset 100 on a 1024 canvas). `apps/desktop/build/icon.icns`
  is rendered from it.
- `apps/desktop/build/AppIcon.icon`: the same artwork as four Icon Composer layers
  (cell, indigo disc, violet disc, sky disc).

## WebUI Tab Icon

Canonical source:

- `docs/images/openprogram-tab-icon.source.svg`

Runtime files:

- `apps/web/app/icon.svg`
- `apps/web/app/favicon.ico`
- `scripts/docs_site/assets/mark.svg`
- `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`

Code reference:

- `apps/web/app/layout.tsx`
- `apps/web/app/manifest.ts`

Current design:

- 64 x 64 SVG: the App icon mark on a rounded tile that fills the canvas.

Sync rule:

- Edit `docs/images/openprogram-tab-icon.source.svg` first.
- Copy the same SVG to `apps/web/app/icon.svg` and `scripts/docs_site/assets/mark.svg`.
- Regenerate `apps/web/app/favicon.ico` (16, 32, 48, 64, 128 and 256 px) and the
  192 and 512 px PWA icons from it. The maskable icon uses a full-bleed tile with
  the cell inside the 80% safe circle.

## WebUI Sidebar Logo

Canonical source:

- `docs/images/logo.svg`

Runtime copy:

- `apps/web/public/images/logo.svg`

Code references:

- `apps/web/components/sidebar/sidebar.tsx`
- `apps/web/public/html/_sidebar.html`

Documentation references:

- `docs/README.md`

Sync rule:

- Edit `docs/images/logo.svg` first.
- Copy the same SVG to `apps/web/public/images/logo.svg`.

## Documentation Logo PNG

Canonical file:

- `docs/images/logo.png`

Use:

- Static documentation image export.
- Keep it as a rendered asset; do not treat it as the editable source.

## Welcome Screen Text Logo

This is not an image file.

Code references:

- `apps/web/components/chat/welcome-screen.tsx`
- `apps/web/components/chat/welcome-screen.module.css`

Use:

- Renders the animated `{LLM}` text mark on the empty chat screen.
- Edit the component and CSS directly if that mark changes.
