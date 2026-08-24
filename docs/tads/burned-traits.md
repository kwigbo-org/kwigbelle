# TAD: burned traits + trait-sheet polish (explode retirement, panel persistence)

- **Status:** IN REVIEW
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
| 9 | New effects (operator asked for ideas) are OUT of this TAD's implementation scope; candidates are listed under Open Questions and get a follow-up TAD amendment or PR once the operator picks. | Don't block the concrete work on a design conversation. |

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

## Client review status

- [x] kwigbelle (single-lane feature; no cross-lane consumers)

## Downstream commitments

None.

## Open Questions

- **New effects — operator to pick any/none** (each would be a
  small follow-up): (a) *Poke* — tap the Avastar to fire a physics
  impulse through the springs, layers scatter and snap back (the
  fun explode provided, but dynamic); (b) *Tilt follow* — on
  mobile, the gyroscope drives the pointer-follow parallax
  (needs the iOS permission tap); (c) *Trails* — a toggle that
  fade-clears the canvas instead of hard-clearing, so motion
  leaves ghosting streaks; (d) *Wave* — a slow depth-staggered
  ripple through the layers at idle.

## Progress log

- 2026-08-24 — Discovery: selector computed + verified, bool[12]
  layout decoded, gene ordering proven against metadata (8700),
  prevalence sampled (3/36). TAD drafted; PR opened for review.
