# TAD: Right-side collapsible panel (effects + traits)

- **Status:** IMPLEMENTED (2026-08-22, PR #6)
- **Driver:** Operator: "I want the next step to be a right side
  collapsable panel. It will have different sections vertically
  collapsable. So we need a base ui there. Top section will be
  effects... Another will be traits. So, we should be able to see
  all traits on an avastar with a visibility checkbox that will
  hide and show the relevant layers for the trait."

## Context

Composition is the only render path (retire-legacy TAD), so every
displayed Avastar carries per-layer trait metadata (`layerInfo`:
gene name, trait name, rarity) index-aligned with the drawn layers.
The spring rig lives in `Lib/LayerSprings.js` with a small set of
depth-scaled parameters. The overlay-component pattern
(PickerUI/WalletConnectUI: constructor takes rootContainer +
collaborators, talks to the scene through narrow callbacks,
`stopSceneEvents` isolation) is established.

## Decisions

1. **`Lib/SidePanel.js` — base UI.** A slim handle tab fixed to the
   right edge; tapping slides out a column overlay above the canvas
   (wrapped in `stopSceneEvents`). Core API:
   `addSection(title, contentElement)` — each section is an
   independently collapsible accordion row. Future sections (remix,
   etc.) are just more registrations. Near-full-width on narrow
   screens via CSS.
2. **Effects section (`Lib/EffectsSection.js`).** Controls map to
   LayerSprings parameters applied at `step()` time — never by
   re-running `setup()`, so tweaks retune the motion mid-flight
   instead of snapping layers to center:
   - Explode (toggle) — reach multiplier, computed live from depth
     so the toggle works without rebuilding springs. `?explode=1`
     stays as the explicit initializer and wins over the stored
     setting on that load.
   - Motion (slider 0–3) — scales sway/breathe amplitudes.
   - Follow (slider 0–2) — scales pointer-follow offset.
   - Pause (toggle) — `step()` early-returns; the rig freezes.
   Settings persist in `localStorage` (`kwigbelle.effects`) like
   the wallet choice.
3. **Traits section (`Lib/TraitsSection.js`).** One row per drawn
   layer — "Gene: Trait Name" with rarity — plus a Backdrop row
   when the composed background layer exists. Checkboxes toggle a
   hidden set the render loop consults (`isLayerVisible(index)` /
   `isBackdropVisible()`). Springs stay allocated, so indices never
   shift. Visibility is display-only scene state: recomposition,
   resize, and the load machinery are untouched. Rows rebuild on
   token swap and visibility resets then (hiding eyes on one
   Avastar must not blind the next). The static fallback has no
   layerInfo → the section shows "trait data unavailable".
4. **Out of scope:** composed thumbnails for picker/trait rows
   (own TAD), any physics-formula change (defaults are
   behavior-identical), remix.

## Verification

- `Tests/panel-test.js`: panel opens; Pause freezes the canvas
  (identical consecutive frames) and unpausing resumes motion;
  trait rows match layerInfo count; hiding every row + backdrop
  empties the canvas center; effects persist across reload.
- Existing 7 tests stay green; `npm run check` clean; build stamp
  bumped.
