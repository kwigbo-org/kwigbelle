# TAD: Load-Avastar section + trait swap preview ("the lab")

- **Status:** DRAFT (2026-08-22) — under panel review (PR #8)
- **Driver:** Operator: "We need to be able to load an arbitrary
  avastar... a top section load avastar button and text input for
  token id... available in the logged out state as well. Also, we
  need to have the ability to change traits. To create a replicant
  you need to burn traits of another so by having the traits
  swappable you can preview what it would look like. Each trait
  should have a button to edit which will bring up a modal of all
  traits that can be in that slot. When a trait is changed in this
  preview it should show the original trait with an undo button."

## Context

Composition is the only render path: all 614 Gen-1 traits are
committed in `Traits/` (indexed by generation:gene:variation, with
name/rarity/gender metadata), and any combination is composable
client-side with no wallet or chain calls. The side panel
(docs/tads/side-panel.md) provides the section registry and the
per-trait cards. `selectAvastar`/`beginLoad` carry the load-race
machinery; `TraitComposer.compose(tokenId)` currently fuses "hash →
picks" and "picks → rendered layers" in one method.

## Decisions

1. **Load section is the TOP panel section and fully walletless.**
   Rationale: operator directive; composition needs no wallet, so
   gating on login would be artificial.
2. **Token ids validate against the hash corpus BEFORE any load.**
   Rationale: an unknown id must show an inline error, not start a
   doomed load that ends in the static fallback.
3. **Load wires through the existing `selectAvastar`.** Rationale:
   the load-race guards, preloader, picker-thumbnail update, and
   traits rebuild are already correct there; a parallel path would
   fork that machinery.
4. **Composer splits into `picksFor(tokenId)` + `composePicks(
   picks, displaySize)`; `compose` stays as the thin wrapper.**
   Rationale: the preview needs "render an arbitrary trait set" as
   a public operation; splitting preserves the byte-exact `fullSVG`
   semantics with one assembly implementation.
5. **Preview state = baseline picks + per-gene override map, owned
   by the scene.** Display renders baseline-with-overrides via
   `composePicks`. Any token load clears overrides. Rationale:
   overrides are display-only state, exactly like trait visibility;
   the load machinery stays untouched.
6. **Override renders reuse the resize-style guards (captured size
   + token identity), never a load-generation bump.** Rationale: a
   pick swap must not invalidate a pending token load, and a stale
   swap render must not overwrite a newer token.
7. **Every slot is editable** — color genes 0-3, backdrop 4, layers
   5-11. Rationale: a replicant needs all 12 genes.
8. **Card affordances:** Edit (✎) per card; an overridden card
   shows the new trait plus "was: <original>" with a per-gene undo;
   a "Reset all" control shows in the section header while any
   override exists; copy marks the feature preview-only ("nothing
   is changed on chain").
9. **Modal options render as TRUE thumbnails from the library**:
   art fragments styled with the CURRENT avastar's color genes
   (color slots show swatch grids). Rendered lazily in batches;
   fragment fetches are cached. Rationale: a preview styled with
   the actual face's colors is the honest preview; this also debuts
   the composed-thumbnail technique the picker follow-up needs.
10. **Gender filter defaults to the base Avastar's gender + unisex,
    with a "show all" toggle.** Rationale: gendered art (Female
    Face N) may not align on the other base; default to sensible,
    allow everything.
11. **Static-fallback displays have no picks → Edit unavailable**
    (same note pattern as trait data).
12. **Out of scope:** on-chain replicant minting / teleporter
    interaction; sharing previews via URL; persisting previews.

## Proposed design surface

```
TraitComposer
  async picksFor(tokenId) -> [12 trait records]     (throws if unknown)
  async composePicks(picks, displaySize) -> display object (unchanged shape)
  async compose(tokenId, displaySize)               (wrapper, unchanged)
  async hasToken(tokenId) -> bool                   (corpus membership)
  async traitsForGene(gene) -> [trait records]      (modal option list)

Lib/LoadSection.js
  new LoadSection(hasToken, onLoad(tokenId))        section body via build()

Lib/TraitEditModal.js
  open(gene, currentPick, { gender, showAll, styles }) -> Promise<pick|null>

TraitsSection (extended)
  card gains Edit button; onEdit(gene) callback into the scene
  showOverride(gene, newPick, originalPick, onUndo)

MainScene (extended)
  baselinePicks, overrides Map<gene, pick>
  applyOverride(gene, pick) / undoOverride(gene) / resetOverrides()
    -> recompose via composePicks with resize-style guards
```

## Steps

1. **Composer split + `hasToken`/`traitsForGene`.**
   Action: refactor compose; add corpus/membership helpers.
   Validate: compose-test content parity (whitespace-stripped)
   stays unchanged — byte parity remains covered by
   Tools/validate-composition.js; new harness assertions
   (picksFor(8014) names match index).
   Rollback: single-commit revert; wrapper keeps old callers.
2. **Load section (PR #8 completes here).**
   Action: LoadSection at top of panel; inline validation; wire to
   selectAvastar.
   Validate: harness — valid id loads walletless, invalid id shows
   error and starts no load, Enter submits.
   Rollback: remove section registration; no other surface touched.
3. **Override state + recompose path in MainScene.**
   Action: baselinePicks/overrides + guarded recompose.
   Validate: harness — override changes canvas; token swap clears;
   pending-load race: override during load never overwrites the
   newer token.
   Rollback: state is additive; revert commit restores pass-through.
4. **Card Edit affordance + "was/undo" + Reset all.**
   Validate: harness — undo restores byte-identical fullSVG.
   Rollback: UI-only commit revert.
5. **Edit modal with thumbnails + gender filter.**
   Validate: harness — option count matches index.json for the
   slot (filtered and show-all); apply closes modal and updates
   canvas + card.
   Rollback: UI-only commit revert.

## Client review status

Single-lane feature; no cross-lane consumers.

- [x] (none — kwigbelle-internal; operator is the only consumer)

## Downstream commitments

- Picker-thumbnail follow-up TAD will reuse the Step 5 thumbnail
  technique (tracked in memory/backlog, not owed to another lane).

## Progress log

- 2026-08-22 — Draft written from operator directive; opened as
  PR #8 for panel review before implementation (pattern (a):
  implementation lands as follow-up commits to this PR).
- 2026-08-22 — Panel round 1 on TAD content: STATUS:CLEAN (2/3;
  both Claude reviewers fact-checked claims against source).
  Minority catch fixed: Step 1 validation wording claimed byte
  parity where compose-test checks whitespace-stripped content
  parity. Beginning Steps 1-2.
- 2026-08-22 — Steps 1-2 applied: composer split (picksFor /
  composePicks / hasToken / traitsForGene; compose is the wrapper)
  and LoadSection wired as the top panel section. Validated by
  Tests/load-test.js: composePicks(picksFor(8014)).fullSVG ===
  compose(8014).fullSVG; hasToken membership; traitsForGene(11) =
  78 sorted records; walletless load of 12345 via Enter; junk and
  unknown ids rejected inline with no load started. Full suite 9/9.
