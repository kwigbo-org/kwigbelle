# TAD: burned traits + trait-sheet polish (explode retirement, panel persistence)

- **Status:** IMPLEMENTED (2026-08-24/25: TAD PR #18, explode/panels
  PR #19, effects + capture PR #20, burned display + cards PR #21)
  — frozen as historical record
- **Driver:** Operator (2026-08-24): "explode is legacy and the
  sliders can kinda replicate that. So ditch it. … We need to show
  burned traits. I think we can make the trait tiles a little
  better. edit is kinda hard to see. The whole thing has good data
  but needs better layout. Especially when burned traits are in
  play. Panels that are collapsed in the side bar should persist
  for the user."

## Context

**Burned traits** (all facts live-verified 2026-08-24 against
mainnet + the metadata endpoint):

- When a replicant was minted, each trait it used was burned on its
  source prime. The AvastarsTeleporter contract
  (`0xF3E778F839934fC819cFA1040AabaCeCBA01e049`) exposes
  `getPrimeReplicationByTokenId(uint256)` (selector `0x480dacfa`,
  computed with the site's own bundled web3 and sanity-checked
  against fetch-hashes' known `getPrimeByTokenId` selector). The
  return is `tokenId` + an INLINE fixed `bool[12]` — no dynamic
  offset — and **index = gene id**: token 8700 decodes to burns at
  genes 0,1,3,7,9, exactly matching the metadata endpoint's
  "- burned" markers on skin_tone/hair_color/background_color/nose/
  facial_feature, its `total traits burned: 5` attribute, and its
  `mint condition: False` attribute.
- `getPrimeByTokenId` does NOT carry the flags (7 words: id,
  serial, traits, generation, series, gender, ranking) — which is
  why hashes.json doesn't have them.
- Prevalence sample: 3 of 36 evenly-spaced primes carry burns
  (5900 all 12; 8700 five; 21300 two) → roughly 2k primes expected,
  so a sparse table stays small (~tens of KB).
- The contract is LOCKED and the replicant factory CLOSED, so the
  flags are frozen forever — same one-time-capture situation as the
  hash corpus and the Unique-By table. Zero runtime chain calls.
- Only primes (#0–25,199, promos included) have the concept;
  replicants can't be replicated.

**Explode**: `?explode=1` + the Effects toggle set
`LayerSprings.isExplodeEnabled`, which multiplies the
depth-proportional separation term in the reach formula by 4
(`explodeScale`) — front-layer reach goes from ~1.35× to ~2.4×,
deeper layers proportionally less, the deepest unchanged. The
Motion (0–3) and Follow (0–2) sliders cover the same ground
continuously — operator calls it legacy.

**Trait cards today** (`TraitsSection.card`): one row per trait —
checkbox/swatch, gene + value + optional "was/undo", and a right
`.traitSide` holding the rarity icon+name and a small `✎` glyph.
Operator: edit is hard to see; the layout needs better hierarchy,
especially once burned marks join the card.

**Panel sections**: `SidePanel.addSection` toggles a `collapsed`
class per header click; state is lost on reload.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Explode is removed entirely: the Effects toggle, the `?explode` URL flag, and `LayerSprings.isExplodeEnabled`/`explodeScale`. A legacy `explode` key in stored settings is simply ignored. README/CLAUDE.md drop the flag. | Operator directive; the sliders replicate the effect continuously. |
| 2 | One-time capture tool `Tools/fetch-burned.js` (fetch-hashes.js pattern: batched, throttled under the Alchemy free tier, resumable, capacity-retry) sweeps primes #0–25,199 via `getPrimeReplicationByTokenId` into `Tools/data/burned.json`: a SPARSE map `tokenId -> mask` where mask is the 12-bit integer with bit g = gene g burned; zero-burn primes are omitted. Marked `-diff`, shipped by deploy.sh. | Frozen on-chain state → static data, like hashes.json/ub.json; sparse keeps it ~tens of KB. |
| 3 | Validation: the tool's `--verify` mode re-fetches a random sample and cross-checks popcount(mask) against the metadata endpoint's `total traits burned` attribute (which also encodes `mint condition`). | Two independent sources (chain + metadata) already agreed in discovery; the sample check keeps the capture honest. |
| 4 | `TraitComposer.burnedFor(tokenId)` lazily fetches burned.json once (ubFor pattern) and returns the mask (0 when absent) for primes, null for replicants. | Same lazy-static-table surface the identity card already uses. |
| 5 | Display: trait cards get a distinct BURNED tag (small flame SVG + text, its own warm color token) shown when the card displays the token's own minted trait; on preview-overridden cards the burn mark moves to the "was:" line — the burn is a fact about the MINTED trait, not the previewed art. The identity card gains one line for primes: "Mint condition" chip when mask is 0, else "N of 12 traits burned". Replicants show nothing. | Burns are token facts (like score/series); tying the tag to the baseline trait keeps the preview honest. Mint condition is the collection's own vocabulary (metadata attribute). |
| 6 | Trait-card layout rework, same DOM contract (`.traitRow`, checkbox semantics, `.traitEdit`/`.traitUndo` class names and callbacks survive for the tests): two-line hierarchy — top line gene name (small, muted) with the rarity icon+tier right-aligned; second line the trait VALUE prominent; the edit affordance becomes a real labeled pill button ("✎ Edit") with border and larger tap target instead of the bare glyph; BURNED tag sits beside the rarity tag. | Operator: good data, weak hierarchy, edit invisible; keeping class names bounds the test churn. |
| 7 | Collapsed panel sections persist per browser: `SidePanel.addSection` keys each section by its title in `localStorage["kwigbelle.panels"]` (`{title: true}` = collapsed), applied at build, written on toggle. Applies to settings-drawer sections (the profile drawer has no sections). | Operator directive; mirrors the kwigbelle.effects pattern. |
| 8 | Ships as two PRs against this TAD: **PR A** — explode removal + panel persistence (small, mechanical); **PR B** — burned capture tool + data + burnedFor + card redesign with burned marks (the data and the layout land together because the layout exists to host the marks). | Review lands on one concern each; PR B waits on the ~40-minute capture run. |
| 9 | New effects: the operator picked ALL FOUR candidates ("lets do them all", 2026-08-24) — they ship as **PR C** per Decision 10. | Amended per this decision's original follow-up clause. |
| 10 | (Amendment) The four effects, concretely: **Poke** — a quick tap on the Avastar (short press, little movement — a drag stays a follow) kicks every layer's spring velocity away from the tap point, front layers hardest; always on, no control. **Wave** — Effects toggle; a traveling PULSE, not a continuous sine (operator QA: a sine read as indistinguishable from the idle breathing, which is already a depth-staggered sine) — every ~3.2s a wavefront sweeps the stack back-to-front and each layer takes a quick out-and-back whip as it passes, resting between pulses; rides the spring targets (idle AND follow alike, so a steady tilt drive doesn't silence it); fixed amplitude, deliberately NOT scaled by the Motion slider so it stands alone (and stays testable at Motion 0). **Trails** — Effects toggle; the render loop fade-erases (destination-out at ~0.22 alpha) instead of hard-clearing, leaving motion ghosts; the backdrop layer is not redrawn while Trails is on (a full-opacity backdrop redraw would cover the ghosts every frame — the themed page background is the stable ground). **Tilt follow** — Effects toggle; deviceorientation beta/gamma (first reading = neutral baseline, ±25° ≈ full reach, clamped) drives the same follow path as the pointer; on iOS the toggle tap calls DeviceOrientationEvent.requestPermission (a stored-on flag restored at load may stay inert on iOS until the user re-toggles — permission calls need a gesture). All three toggles persist in `kwigbelle.effects`. | Poke restores explode's payoff interactively; Wave/Trails/Trails-vs-backdrop and the tilt permission dance are the load-bearing implementation constraints, locked here so review can check against them. |

## Proposed design surface

```
Tools/fetch-burned.js         AVASTARS_RPC_URL=<endpoint> node ...
                              [--verify N]  -> Tools/data/burned.json
Lib/TraitComposer.js          burnedFor(tokenId) -> Promise<mask|null>
Lib/TraitsSection.js          card(): two-line layout, Edit pill,
                              BURNED tag; identityCard(): mint
                              condition / burned count line
Lib/EffectsSection.js         explode toggle + override param gone
Lib/LayerSprings.js           isExplodeEnabled/explodeScale gone
Lib/SidePanel.js              addSection persistence via
                              localStorage kwigbelle.panels
deploy.sh                     ships Tools/data/burned.json
```

## Steps

1. **PR A — explode retirement + panel persistence.** Action:
   Decisions 1 and 7; build-stamp bump. Validate: panel-test grows
   a collapse-persist-across-reload assertion; full suite; grep
   proves no `explode` references remain outside TAD history.
   Rollback: revert the squash commit.
2. **Capture run (tooling, no PR gate).** Action: write
   fetch-burned.js, run the ~25,200-call sweep (resumable), then
   `--verify` a sample against metadata. Validate: sample matches;
   re-run produces byte-identical output. Rollback: n/a (new file).
3. **PR B — burned display + card redesign.** Action: Decisions
   2–6; commit burned.json (`-diff`); deploy.sh ships it.
   Validate: identity-test grows burned/mint-condition assertions
   (8700-class token vs a mint-condition token vs a replicant);
   panel-test/lab-test survive the layout rework unchanged where
   the DOM contract holds; full suite. Rollback: revert PR B —
   PR A stands alone.
4. **PR C — the four effects (Decision 10).** Action: LayerSprings
   gains poke() and the wave term; MainScene gains tap detection,
   trails rendering, and tilt wiring; EffectsSection gains the
   Wave/Trails/Tilt toggles (persisted). Validate: new
   Tests/effects-test.js — poke moves an otherwise-static rig
   (Motion 0, Follow 0, so ONLY the impulse can move layers), Wave
   animates at Motion 0, Trails leaves intermediate-alpha pixels,
   a synthetic deviceorientation event steers the rig with tilt
   enabled, and toggle states survive a reload; full suite.
   Rollback: revert PR C — A and B stand alone.

## Client review status

- [x] kwigbelle (single-lane feature; no cross-lane consumers)

## Downstream commitments

None.

## Progress log

- 2026-08-24 — Discovery: selector computed + verified, bool[12]
  layout decoded, gene ordering proven against metadata (8700),
  prevalence sampled (3/36). TAD drafted; PR #18 opened.
- 2026-08-24 — Round 1 CLEAN 2/3 (lite); sonnet's prose LOW on the
  explode reach math truth-fixed. Round 2 CLEAN 3/3; merged as
  `6d05dad`. PR A (#19) opened; capture sweep started.
- 2026-08-24 — Operator picked ALL FOUR effects candidates: Open
  Question folded into Decisions 9–10, Step 4 (PR C) added.
- 2026-08-24 — PR A (#19) merged as `cf7bc76` (round 1 CLEAN 3/4,
  sonnet test-robustness LOW fixed; round 2 CLEAN 4/4). Capture
  sweep COMPLETE: 2,229 primes with burns, 16,834 traits burned
  total (the ~170 shortfall vs 1,417×12 is consistent with
  replicants using "None"-type empty slots that burn nothing);
  `--verify 20` matched chain AND metadata on every sample,
  including partial masks and a full 4095. Step 2 done.
- 2026-08-24 — Deviation from Decision 8's PR split, recorded
  honestly: the Step 2 artifacts (fetch-burned.js + the verified
  burned.json) were swept into PR C (#20) by a `git add -A` during
  a review fix-push. Kept there rather than rewriting a reviewed
  head — the panel reviewed the tool (Codex caught a resume gap:
  failed tokens advanced `through`, so a re-run could finalize
  without their burns → failures are now recorded in the progress
  file and retried before finalizing). PR B carries the display
  code only.
- 2026-08-24 — Step 4 applied (PR C): poke/wave/trails/tilt per
  Decision 10. index.html now exposes the scene as
  `window.kwigbelleScene` for the harness — effects-test asserts
  on spring state (velocities/offsets) because the underdamped
  rig decays asymptotically and pixel-equality flakes on subpixel
  motion (gated behind `?testharness=1` per review).
- 2026-08-24 — PR #20 review rounds 1–4 (merged as `87b0cf7`):
  round 1 was 0/4 with genuine mobile catches — a touch tap's
  synthetic mouse replay double-fired the poke (and a touch drag
  could mis-fire one), fixed with an 800ms suppression window +
  `touch-action:none` on the canvas + a hasTouch test asserting
  exactly one poke; tilt permission races closed with a
  generation counter; Wave gained the follow-target ride. Wave
  itself became the traveling pulse after operator QA.
- 2026-08-25 — Step 3 applied (PR B, #21, merged as `7155bc8`
  after 5 rounds + operator QA). QA amendments to Decision 6
  during the PR: the labeled Edit pill's dedicated column crowded
  the 280px panel, so the WHOLE CARD is the edit tap target (rows
  are divs, checkbox/undo are stopPropagation islands), a compact
  edit chip rides the gene line, and the tier/burn tags own a
  full-width line under the prominent trait name. Decision 5
  amendments: Mint condition renders in a positive mint green
  (`--mint` #3eb489), never the burn orange; the ember orange has
  ONE definition (`--burned`, flame fills currentColor). Burn
  state applies to ALL primes including promos (asserted for
  founder #50) — unlike the lottery-only Unique-By. Also shipped
  here as an operator-directed extension of profile-drawer TAD
  Decision 5: the wallet badge became an always-visible presence
  dot (grey logged out, pulsing mint when connected,
  reduced-motion respected). Final review LOW (a test-diagnostics
  precondition) cut off as non-load-bearing per the iteration
  discipline. TAD frozen.
