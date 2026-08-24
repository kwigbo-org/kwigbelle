# TAD: avastars.io design cues (dark theme, rarity icons, identity card)

- **Status:** IMPLEMENTED (2026-08-23, PR #12) — frozen as
  historical record
- **Driver:** Operator: "We need to match the design cues of the
  avastars site... including the rarity icons." + "We need to mark
  avastars with these indicators" (series ranges infographic) +
  rarity reference drop (score scale, Discord bot embed with the
  five tier icons and Unique-By counts, community rarity guide).

## Context

All facts below were verified against live sources on 2026-08-22/23;
everything the display needs is already in local data — this feature
adds ZERO runtime data/API calls. (The one new network dependency is
the Google Fonts stylesheet for Inconsolata, Decision 2, with a
monospace fallback stack if it fails to load.)

**avastars.io visual language** (probed live from the running site):

- Background: deep navy-purple `#150437`, purple gradient section
  bands, subtle dot/star accents.
- Typeface: **Inconsolata** (Google Fonts) — the whole site is
  monospace. Headings: uppercase, letterspaced, bright blue
  `#0D8FFB`.
- Text: white / `#F7F8FC`; muted gray-lavender `#AAA8AD`.
- Accent purples: `#280B9C`, `#5B19E5`, CTA `#AC1DFF`.

**Rarity system** (operator-supplied reference, verified locally):

- Every token has a 1-100 score — it IS the `ranking` field already
  in `Tools/data/hashes.json` (verified: metadata `ranking` equals
  ours for every spot check).
- Tier bands, verified at ALL FOUR edges against the `level`
  attribute served by the on-chain tokenURI metadata endpoint
  (https://avastars.io/metadata/{id} — NOT a local hashes.json
  field; tokens 205/225, 245/214, 223/244, 499/10):
  Common < 33 ≤ Uncommon < 41 ≤ Rare < 50 ≤ Epic < 60 ≤ Legendary.
  Matches the operator's score-scale screenshot exactly.
- Tier icons (Discord bot embed / avastars.io iconography):
  Common = blue square, Uncommon = green circle, Rare = amber
  triangle, Epic = purple ellipse, Legendary = red diamond.
- Mint odds (community guide, display-context only): C 60%,
  U 22.5%, R 12.5%, E 4.75%, L 0.25%.
- Trait changeout cadence across series (context, not displayed):
  Common rotated every series, Uncommon every 2, Rare {1-3}/{4-5},
  Epic {1-4}/{5}, Legendary constant.

**Series** (verified earlier, in memory + PROGRESS):
`hashes.json` carries per-token `series` 0-5 and `kind`
(prime/replicant); boundaries match the Gen-1 infographic exactly
(0-199 promo/founders, 5,000 per series, replicants 25,200+ with no
series). The infographic assigns each series a color: S0 teal,
S1 purple, S2 magenta, S3 blue, S4 cyan, S5 violet.

**Unique-By (UB) counts — definition currently AMBIGUOUS:** the
community bot reported #8184 as "UB2 combos: 0, UB3 combos: 0"
(Aug 2023). Local computation over all 12 genes and the full
26,617 population gives u3=6 (and combos only shrink as mints
continue, so all-12 is definitively NOT the bot's definition);
restricting to the 7 art genes (5-11) or art+backdrop (4-11) both
give 0 for #8184 but disagree on other tokens (8014: 0 vs 3). The
written guides say colors CAN participate ("unique by Eye Color
and Skin Tone"), contradicting the art-only subsets. The Discord
bot that could have disambiguated NO LONGER FUNCTIONS (operator,
2026-08-23), so the historical formula is unrecoverable — and with
the bot gone, there is no live authority to stay consistent with.
Resolution: kwigbelle defines its own transparent metric — all 12
traits, uniqueness over the LOTTERY-PRIME population only
(#200-25,199; operator 2026-08-23). Excluded from both the
comparison population and the metric itself, because none of them
played the same mint lottery:
- Founders #0-99 and Exclusives #100-199: hand-picked traits.
- Replicants #25,200+: assembled from burned prime traits.
All three still show score/tier/distribution — only the
Unique-By line is lottery-prime-only. The corpus is frozen, so
the counts are computed ONCE and never change.

## Decisions

1. **Chrome-only dark theme via CSS custom properties.** A
   `:root` palette block (background `#150437`, surface, border,
   heading-blue `#0D8FFB`, accent `#AC1DFF`, muted `#AAA8AD`,
   tier and series colors) and a restyle of every UI surface —
   side panel, sections, cards, modal, picker, wallet button,
   load/effects/3D controls, loading overlays — to the avastars.io
   language. The ART AREA IS EXEMPT: the canvas backdrop stays the
   token's own background color (art-driven, as today). No layout
   or behavior changes; markup/classes stay put so the harness
   keeps passing as the regression gate.
2. **Typography: Inconsolata.** One Google Fonts stylesheet link
   (the `<head>` already preconnects to fonts.googleapis.com /
   fonts.gstatic.com), family stack `Inconsolata, monospace`
   applied to the UI chrome. Headings uppercase + letterspaced +
   heading-blue, mirroring the site.
3. **Rarity tier icons as inline SVGs** — square/circle/triangle/
   ellipse/diamond, one canonical `rarityIcon(tier)` helper (new
   `Lib/RarityIcons.js`), colors pinned: Common `#0D8FFB`,
   Uncommon `#2ECC71`, Rare `#F5A623`, Epic `#7B52D4`, Legendary
   `#FF4757`. Used: beside the rarity name in trait cards, in the
   modal option tiles, and in the identity card's distribution
   row. The modal's rarity FILTER stays a native `<select>` (no
   SVG in options) but its labels keep the tier names.
4. **Identity card at the top of the Traits section**, shown in
   both vector and 3D (read-only) modes — it is informational:
   - "Avastar #N" title + kind chip: "Prime" / "Replicant" /
     "Founder" (#0-99) / "Exclusive" (#100-199) — the promo
     sub-kinds are pure token-id ranges from the Gen-1 series
     sheet
   - "Gen 1 · Series N" chip tinted with that series' color
     (replicants: neutral "Replicant" chip only; Founder/
     Exclusive chips take the Series-0 teal)
   - "Score N" + tier icon + tier name, tinted by band (the
     verified band edges above)
   - Trait distribution row: the five tier icons each with the
     count of the token's 12 traits in that tier (bot-style)
   - Static-fallback displays (no picks) keep today's
     "trait data unavailable" note and show id, kind/series
     chips, AND the score line — everything hash-derived (no
     composition needed); only the distribution row needs picks.
   Data plumbing: `TraitComposer.compose` already reads the
   hashes entry (it stamps `gender`) — it additionally stamps
   `series`, `kind`, and `ranking`. `composePicks` output for
   pure previews carries them as null; the scene passes the
   loaded token's values through, same as `gender` today.
5. **Overridden previews keep the LOADED token's identity card**
   (id/series/score are properties of the token, not the preview),
   but the distribution row reflects the DISPLAYED traits —
   consistent with cards showing overridden values, and the
   preview-only note already sits right there.
6. **UB counts: a LOTTERY-PRIME metric with kwigbelle's own
   transparent definition.** The historical bot formula is
   unrecoverable (bot defunct), so the metric is defined here: a
   UB-N combo is a set of N of a token's 12 traits
   (gene:variation pairs) worn by NO other token among the
   lottery primes #200-25,199. Founders, Exclusives, and
   Replicants neither dilute the population nor receive the
   metric (Context above; operator directives) — their identity
   cards show their kind chip, score+tier, and the distribution
   row, with no Unique-By line. `Tools/compute-ub.js` precomputes
   per-token UB2/UB3 combo counts into `Tools/data/ub.json`
   (committed, `-diff`, shipped by deploy.sh alongside
   hashes.json); the identity card's line carries a muted
   "(all 12 traits, among Series 1-5 primes)" qualifier so the
   numbers are never mistaken for the old bot's. Known deltas
   from the dead bot's output are expected (e.g. #8184: ours 10
   UB3 combos, bot said 0) and documented here, not hidden.
   Locally-computed anchors for validation: #8014 u2 1 / u3 41,
   #8184 u2 0 / u3 10, #200 u2 0 / u3 21, #25199 u2 0 / u3 18;
   3,034 of the 25,000 lottery primes carry at least one UB2
   combo. (Excluding the hand-picked promos measurably matters:
   #8014's unique pair only exists once they're out of the pool.)
7. **Out of scope:** layout redesign or avastars.io content/nav
   mimicry; the dotted starfield background (possible later
   accent); score-meter widget (their tool UI, not a site cue);
   UB1/UB4+; odds/changeout display; theming the Avastar art
   area.

## Proposed design surface

```
style.css
  :root { --bg, --surface, --border, --heading, --accent, --muted,
          --tier-common..--tier-legendary, --series-0..--series-5 }

Lib/RarityIcons.js
  rarityIcon(rarity) -> SVGElement        (0-4, canonical shapes)
  tierForScore(score) -> { rarity, name } (band edges 33/41/50/60)

TraitsSection (extended)
  identity card built from avastar.{tokenId, kind, series, ranking,
  traits} at the top of rebuildRows (both modes)

TraitComposer.compose (extended)
  stamps series/kind/ranking from the hashes entry

Tools/compute-ub.js            (Step 4; lottery primes #200-25,199)
  -> Tools/data/ub.json  { "<tokenId>": { "u2": n, "u3": n } }
```

## Steps

1. **Data plumbing + identity card (unstyled).**
   Action: composer stamps series/kind/ranking; TraitsSection
   renders the card; scene passes fields through previews.
   Validate: harness — 8014 shows "Score 36", Uncommon, "Series
   2", Prime, distribution counts summing to 12 and matching the
   library index for its picks; a replicant id shows the
   Replicant chip and no series; overridden preview keeps the
   token's score/series while the distribution follows the
   override.
   Rollback: additive fields + one section block; single revert.
2. **Rarity icons.**
   Action: Lib/RarityIcons.js + integration in cards, modal
   tiles, distribution row.
   Validate: harness — each tier renders its shape (svg node
   present per card, fill matches the tier color for a known
   token's known-tier traits); lab-test still green (rarity
   filter untouched).
   Rollback: UI-only revert.
3. **Dark theme + typography.**
   Action: palette custom properties, Inconsolata link, restyle
   of every chrome surface; bump the build stamp.
   Validate: full suite green (structure untouched); manual QA
   pass on 127.0.0.1:8000 across panel/modal/picker/3D flows;
   screenshots archived in the PR for operator QA.
   Rollback: style.css + index.html font link revert.
4. **UB counts (kwigbelle definition per Decision 6; corpus
   frozen so this computes once).**
   Action: Tools/compute-ub.js (lottery primes #200-25,199
   only); ub.json committed + `-diff`; deploy.sh ships it next
   to hashes.json; identity card gains the Unique-By line with
   the "(all 12 traits, among Series 1-5 primes)" qualifier;
   Founder/Exclusive/Replicant cards omit it.
   Validate: script re-run is byte-identical (determinism);
   internal invariants (u2 <= C(12,2), u3 <= C(12,3), a token
   with a u2 combo has >= 10 u3 combos containing it); ub.json
   has exactly 25,000 entries; harness asserts the line for the
   anchors (8014: u2 1 / u3 41) and its ABSENCE on a founder
   (#50) and a replicant; `./deploy.sh -w` serves ub.json.
   Rollback: remove the line + file; deploy.sh line revert
   (risk-sensitive file - minimal one-line diff).

## Client review status

Single-lane feature; no cross-lane consumers.

- [x] (none — kwigbelle-internal; operator is the only consumer)

## Downstream commitments

None. The VRM viewer's toggle/section/overlay pick up the palette
in Step 3 with no structural change (vrm-viewer TAD unaffected).

## Progress log

- 2026-08-23 — Draft written from the operator's reference drop
  (score scale, bot embed, community guide, series infographic)
  after verifying: score=ranking locally with exact band edges
  against metadata `level`; series/kind already local; UB
  definition ambiguous (all-12 contradicts the bot; art-subset
  variants fit #8184 but need a second sample) — Step 4 gated on
  operator bot samples. Opened for panel review before
  implementation (pattern (a)).
- 2026-08-23 — Operator: the Discord bot no longer functions, so
  the historical UB formula is unrecoverable. Decision 6 updated:
  kwigbelle defines its own transparent metric (all 12 traits,
  full frozen population, labeled in the UI); Step 4 un-gated
  with determinism/invariant validation replacing the bot
  cross-check.
- 2026-08-23 — Operator: "rarity needs to cut off at replicants
  or replicants need to be a different rarity mechanism. The last
  Avastar prime minted was 25199." Decision 6 re-scoped: UB is a
  prime-only metric (population #0-25,199); replicants excluded
  from the comparison AND from the display (they are assembled
  from burned prime traits - the mint-lottery framing does not
  apply). Anchors recomputed prime-scoped: 8014 u2 0/u3 40, 8184
  u2 0/u3 10, founder #0 u2 0/u3 195. Score+tier display remains
  for replicants (they carry their own ranking).
- 2026-08-23 — Operator: Founders #0-99 and Exclusives #100-199
  have HAND-PICKED traits — not the same lottery — and are also
  excluded from rarity. UB population re-scoped to the lottery
  primes #200-25,199 (25,000 tokens); promo cards (new Founder/
  Exclusive kind chips) omit the Unique-By line like replicants.
  Anchors recomputed: 8014 u2 1/u3 41 (the unique pair appears
  only once promos leave the pool — the exclusion measurably
  matters), 8184 0/10, #200 0/21, #25199 0/18; 3,034 of 25,000
  carry a UB2 combo.
- 2026-08-23 — Panel round 1 (lite): 1/3 CLEAN. All prose fixes:
  the zero-network claim narrowed to data/API calls (the
  Inconsolata stylesheet IS a runtime fetch, with a fallback
  stack); `level` clarified as the tokenURI metadata attribute,
  not a hashes.json field; stale "(gated Step 4)" label in the
  design surface updated to the lottery-prime definition.
- 2026-08-23 — Panel round 2: STATUS:CLEAN (3/3). Beginning
  implementation as follow-up commits.
- 2026-08-23 — Steps 1-2 applied: composer stamps kind/series/
  ranking (+ tokenInfo for the static path); Lib/RarityIcons.js
  (tier shapes/colors/bands + kindLabel); identity card in
  TraitsSection; icons in trait cards, modal tiles, distribution
  row. Validated by Tests/identity-test.js: 8014 (Prime, Series 2,
  Score 36 Uncommon, distribution 6/4/1/0/1 matching the index),
  25500 (Replicant, no series chip, Score 61 Legendary), 50
  (Founder + Series 0); overrides keep token identity and undo
  restores the distribution. Suite 14/14.
- 2026-08-23 — Step 3 applied: dark chrome theme (tokens in
  :root; every surface restyled - panel, cards, modal, picker,
  wallet, toggles, overlays; art area untouched per Decision 1);
  Inconsolata linked with monospace fallback; heading voice
  (uppercase, letterspaced, #0D8FFB); initial page background is
  the navy until the token's own color lands. Stamp 2026-08-23.1.
  One test-side truth: `text-transform: uppercase` changes
  innerText, so tests compare textContent for transformed
  elements (title, section headers). Deviation from draft: the
  modal's art thumbnails keep a LIGHT plate (#F7F8FC) - the
  fragments are drawn for the token's face colors and go
  illegible on navy. Suite 14/14 against the themed build.
- 2026-08-23 — Step 4 applied: Tools/compute-ub.js (lottery
  primes #200-25,199, all invariants enforced in-script);
  Tools/data/ub.json committed (611KB, -diff, deterministic -
  identical sha256 across runs); deploy.sh ships it (verified in
  the build output); composer.ubFor lazy-loads the table; the
  identity card's Unique-By line fills in async with the
  "(all 12 traits, among Series 1-5 primes)" qualifier and is
  absent for founders/exclusives/replicants. Anchors asserted in
  the harness (8014: 2-trait 1 / 3-trait 41; absent on 50 and
  25500).
- 2026-08-23 — Panel round 3 on the implementation: 3/4 CLEAN.
  Codex minority catch fixed as a fix-push (and Decision 4
  truth-fixed): the static fallback stamped kind/series but
  dropped ranking, losing the score line the hash lookup already
  had — the real constraint is "no composition", not "chips
  only", so the fallback now carries ranking too.
