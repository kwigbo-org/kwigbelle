# TAD: Pinch-to-zoom — true vector zoom on the 2D Avastar

- **Status:** IN REVIEW
- **Driver:** Operator (2026-08-29): "can we make a pinch to zoom
  on the vector avastar? With an actual zoom with the vectors and
  not just a zoom on the page." Confirmed directions: NO zoom on
  the background canvas; gesture rules below agreed.

## Context

- The 2D view draws each Avastar as moving layers on the main
  canvas: `TraitComposer.toImage(content, isBackground,
  displaySize)` wraps each layer's SVG fragment set in a root tag
  sized to the canvas and rasterizes it into an `Image`; the
  render loop `drawImage`s each layer at its spring offset. The
  SVG source survives composition — the composer's fragment
  library stays loaded — so layers can be re-rasterized at any
  size without refetching anything. THAT is what makes "actual
  vector zoom" possible: zooming re-renders the vectors at the
  new scale instead of magnifying pixels.
- The canvas is sized in CSS pixels (`window.innerWidth/Height`,
  no `devicePixelRatio` factor). Today's display is effectively
  1x; a zoom re-raster is strictly sharper than anything the site
  shows now.
- The backdrop (gene 4) already lives on its OWN canvas behind
  the main one (docs/tads/info-tab.md Decision 6): Trails fading
  and the 3D entry never touch it. That separation makes "don't
  zoom the background" free — the zoom transform simply never
  applies to that canvas.
- Pointer input currently drives face-follow (pressed pointer
  wins over tilt), tap-poke, and lock-layers whole-face drag —
  all single-pointer. Nothing uses two pointers or double-tap
  today, so pinch and double-tap are unclaimed gestures.
- The static fallback path (composer failure → one full-render
  layer via `staticImage(sourceSVG)`) keeps its SVG source too,
  so it can zoom through the same mechanism.
- 3D mode already has pinch/scroll zoom via OrbitControls and is
  out of scope.

## Decisions

| #   | Decision | Rationale |
| --- | -------- | --------- |
| 1   | **Two-phase zoom render.** During the gesture, the render loop applies a plain canvas transform (scale about the gesture focal point + pan) over the existing layer rasters — cheap, full frame rate, slightly soft at high zoom. When the gesture settles (~150 ms without change), the layers re-rasterize from their retained SVG sources at the settled scale and swap in, snapping crisp. The swap is generation-guarded like every other async raster in MainScene: a stale re-raster (token changed, zoom changed again) is dropped. | Re-rasterizing every gesture frame would stutter on phones; a transform-only zoom would never be "actual vector zoom." The two-phase split (the standard map-app pattern) gives both: 60 fps response and true vector crispness a beat later. |
| 2   | **Gesture rules** (operator-agreed 2026-08-29): pinch (two pointers) zooms about the fingers' midpoint; at zoom = 1 a single-pointer drag behaves exactly as today (follow, or whole-face drag under Lock layers); at zoom > 1 a single-pointer drag PANS and pointer-follow is suppressed (tilt follow, when enabled, still runs); double-tap resets to 1× with an animated glide; tap-poke is unchanged at any zoom (a poke's tap is distinguished from a double-tap's first tap by the existing tap timing). Desktop: ctrl+wheel (the trackpad-pinch event) zooms about the cursor; plain wheel stays untouched. | Pinch and double-tap are unclaimed, so no existing interaction is displaced. The drag split is the only real conflict and "pan when zoomed, follow when not" matches what a user's finger means in each state. |
| 3   | **The backdrop canvas does NOT zoom** (operator decision). The zoom transform applies only to the main canvas's layer pass; the backdrop keeps painting full-viewport behind it. | Zooming into the face while the backdrop holds still amplifies the depth illusion the spring rig already sells — and it reads as "leaning into the Avastar," not page zoom. Mechanically free given the backdrop's own canvas. |
| 4   | **Zoom range 1–4×, pan clamped, raster capped.** Zoom clamps to [1, 4]; below-1 pinches rubber-band back to 1. Pan clamps so the layer content never detaches from the viewport. The re-raster size is `zoom × canvas size` but each raster dimension caps at 4096 px — past the cap the transform upscales the capped raster (still far sharper than 1×). | 4× is deep enough to inspect line work. The dimension cap keeps worst-case memory sane on large desktop windows (an uncapped 4× of a 2560-wide canvas would raster 10k-px images per layer). |
| 5   | **Zoom is transient view state**: it resets to 1× on every token load, trait-swap preview recompose, resize, and 3D entry. It is not persisted and gets NO effects-drawer control — the gesture is the whole interface (same doctrine as poke). | Zoom is a moment of inspection, not a display setting. Carrying it across token swaps or reloads would mostly surprise. |
| 6   | **Physics and effects stay live under zoom, in scene space.** The springs keep stepping in unzoomed canvas coordinates; the zoom transform is applied at draw time only. Pointer-derived points that survive at zoom > 1 (poke) map through the inverse transform so the impulse lands where the finger actually touched. Trails' destination-out fade pass runs at identity transform (whole-canvas erase, as today), so ghosts fade uniformly and never smear at the wrong scale. | One coordinate space for physics keeps LayerSprings untouched — the feature stays a MainScene draw/input concern. Amplified parallax at zoom comes free from drawing the same spring offsets under a scale. |
| 7   | **Verification**: a new `Tests/zoom-test.js` drives synthetic pinch/double-tap through the `?testharness` scene handle and asserts (a) zoom state changes and clamps, (b) the settled re-raster actually swapped in at the settled scale (layer image dimensions), (c) double-tap resets, (d) pan clamps, and (e) a token load resets zoom. Existing suite must stay green unchanged. | The re-raster swap is the load-bearing claim ("actual vectors, not page zoom") — the test pins it structurally, not visually. |
| 8   | Ships as two PRs: **PR A** — this TAD. **PR B** — implementation + test. | House pattern: decisions reviewed before diffs. |

## Progress

- 2026-08-29 — TAD drafted after pipeline verification (layer SVG
  sources retained through composition; backdrop canvas already
  separate; two-pointer and double-tap gestures unclaimed).
  Operator pre-agreed: no background zoom, gesture rules.
