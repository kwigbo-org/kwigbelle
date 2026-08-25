# TAD: info tab (traits + rarity explainer + transfer history), layer locks, motion retune, backdrop fixes

- **Status:** IN REVIEW
- **Driver:** Operator (2026-08-25): "Info tab between profile and
  settings. move traits to info and add details of how rarity is
  calculated. make layers lockable for movement and make movement
  more purposful. full background on svg is behind the vrm.
  history of transfers for info tab. background sqished on mobile"

## Context

- **Drawer stack** (docs/tads/profile-drawer.md): SidePanel already
  supports N drawers via `addDrawer`; `addSection` is hard-wired to
  the lazily-created settings drawer. Registration order = stack
  order, so profile → info → settings comes free.
- **Traits section**: one `addSection("Traits", …)` call in
  MainScene; the section object is self-contained (identity card +
  cards + callbacks), so moving it is a re-registration, not a
  rewrite.
- **Rarity facts** (all frozen, from docs/tads/design-cues.md and
  burned-traits.md): score = the on-chain 1–100 `ranking`; tier
  bands Common <33 ≤ Uncommon <41 ≤ Rare <50 ≤ Epic <60 ≤
  Legendary (verified at all four edges); every trait carries its
  own contract-assigned tier; Unique-By counts among the 25,000
  lottery primes (#200–25,199); burns are per-trait chain facts.
- **Transfer history** (probed 2026-08-25): ERC-721
  `Transfer(address,address,uint256)` logs with the token id in
  topic 3 give the full provenance including the 0x0 mint. The
  tooling RPC (Alchemy free) caps `eth_getLogs` at 10-block
  ranges, and every probed keyless public RPC (llamarpc unreachable,
  ankr auth-walled, cloudflare erroring, drpc 10k-block cap)
  refuses full-range queries — so the site CANNOT offer walletless
  history without a new paid dependency. The connected WALLET's
  provider is the existing runtime chain path (owned-token
  enumeration, render fallback) and mainstream wallet backends
  serve single-token topic filters over full ranges.
- **3D background**: enter3D clears the 2D canvas but leaves
  `contentView` painted with the TOKEN's SVG background color, so
  the flat token color sits behind the VRM (operator flags it).
- **Mobile backdrop squish**: the backdrop layer rasterizes with
  `preserveAspectRatio="xMidYMid meet"` sized 100%×100% and is
  drawn stretched to the canvas (`drawImage(..., width, height)`),
  distorting the 1000×1000 art on non-square viewports — worst on
  tall phones.
- **Spring rig**: idle motion is per-layer sine sway/breathe with
  depth-scaled amplitudes and phases; the operator wants layers
  individually lockable and the motion to feel "more purposeful".

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | A third drawer, **info**, stacks between profile and settings (registration order in MainScene). Handle icon: inline currentColor SVG "i-in-circle", same 30px `handleIcon` size. `SidePanel.addSection` gains an optional drawer-id argument (default "settings", back-compat); the info drawer hosts collapsible sections exactly like settings. | Operator directive; the drawer stack and section machinery already generalize. |
| 2 | The **Traits** section (identity card + trait cards) moves to the info drawer wholesale — same section object, same callbacks, same DOM ids/classes, registered under info instead of settings. Settings keeps Load Avastar / Effects / 3D model. | Traits are information; the operator's split is info vs controls. |
| 3 | New **"How rarity works"** section at the top of the info drawer: a static, collapsible explainer of the frozen facts — the 1–100 score (on-chain ranking from the 12 traits' rarities), the five tier bands with their icons and thresholds, per-trait tiers, the distribution row, Unique-By (what it counts and the Series 1-5 lottery-primes population), and burned/mint condition. Pure static DOM from the tokens in RarityIcons; zero data fetches. | Operator: "details of how rarity is calculated"; every fact is already frozen and verified in the design-cues/burned-traits TADs. |
| 4 | **Layer locks**: SPRING-BACKED layer cards (genes 5–11 — the entries of `avastar.layers` that ride LayerSprings) gain a padlock toggle beside the visibility checkbox. A locked layer's spring is pinned — no idle sway, no follow/tilt reach, no poke impulse; it re-joins the motion smoothly when unlocked (spring target returns, no snap). Lock state is per-token scene state like visibility (reset on token swap), consulted by LayerSprings via a locked-set the section maintains. Color genes (0–3) have no layer, and the gene-4 backdrop is drawn separately WITHOUT a spring (it never moves), so neither gets a lock — visibility remains the backdrop's only toggle. | Operator directive; mirrors the visibility pattern the render loop already consults. Gene 4 exclusion per review: a motion lock on the motionless backdrop would be a lie. |
| 5 | **Purposeful motion retune** (operator QA gates the feel): idle breathing becomes depth-COHERENT — one shared slow breath phase with a small depth lag, instead of fully independent per-layer phases — at a slower cadence (sway ~0.6→0.45 Hz-ish, breathe ~0.9→0.7) with slightly deeper front-layer amplitude. The face then breathes as one being with parallax depth, rather than layers wandering independently. Poke/Wave/follow are untouched. | "More purposeful" interpreted as coherent-not-random; parameters are one-line tunables for QA. |
| 6 | **3D background fix**: entering 3D swaps `contentView`'s background to the theme `--bg` (the dark chrome), and exit3D restores the token's color. The VRM floats on a neutral studio ground instead of the token's flat SVG color. | Operator flags the token color behind the VRM; a neutral dark ground is the standard 3D-viewer treatment and keeps the ART AREA exemption intact in 2D. |
| 7 | **Backdrop squish fix**: the backdrop rasterizes with `preserveAspectRatio="xMidYMid slice"` (cover: fill and crop, never distort). The 2D draw keeps filling the canvas; the art stays square-true on any viewport. | Root cause is stretch-to-fit of square art; slice is the one-token fix at the rasterization layer. |
| 8 | **Transfer history** section in the info drawer: loads through the CONNECTED WALLET's provider (`eth_getLogs`, Transfer topic + token id in topic 3), lazily on first expand per token, newest first — "Minted" for the 0x0 origin, short addresses, block number, and dates resolved via `eth_getBlockByNumber` for at most the newest 12 rows. Walletless (or a wallet whose RPC declines ranged getLogs): a quiet note — "Connect a wallet to load transfer history." No new site RPC dependency. | Probes show no keyless full-range getLogs exists; the wallet provider is the established runtime chain path, and history is the one non-frozen datum the site now shows. |
| 9 | Ships as three PRs against this TAD: **PR A** — info drawer + traits move + rarity explainer + both fixes (Decisions 1–3, 6–7); **PR B** — layer locks + motion retune (4–5, QA-gated feel); **PR C** — transfer history (8). | A is structure and bugfixes; B is physics feel the operator must QA; C stands alone on the wallet path. |

## Proposed design surface

```
Lib/SidePanel.js         addSection(title, element, drawerId = "settings")
Lib/InfoSections.js      (new) rarityExplainer() -> element;
                         TransferHistory class: build(), setToken(id),
                         onExpand -> lazy load via avastarLoader
Lib/AvastarLoader.js     transferHistory(tokenId) -> Promise<[{from,
                         to, block, date}]> via the wallet provider
Lib/TraitsSection.js     lock toggles on layer cards; isLayerLocked()
Lib/LayerSprings.js      step() consults a locked-set: pinned target
                         = center, impulses skipped; coherent-breath
                         idle retune
Lib/MainScene.js         info drawer registration; 3D bg swap;
                         backdrop slice; poke respects locks
```

## Steps

1. **PR A — structure + fixes.** Action: Decisions 1–3, 6–7; stamp
   bump. Validate: panel/identity/lab tests re-pointed at the info
   drawer (new `#infoHandle`); explainer content assertions; a 3D
   round-trip asserts the contentView background swap/restore;
   a mobile-viewport test asserts the backdrop's drawn aspect.
   Rollback: revert squash.
2. **PR B — locks + motion.** Action: Decisions 4–5. Validate:
   effects-test grows lock scenarios (locked layer immobile under
   wave/poke/follow while others move; smooth rejoin; reset on
   token swap); operator QA gates the retuned feel. Rollback:
   revert squash — PR A stands.
3. **PR C — transfer history.** Action: Decision 8. Validate: a
   mocked provider serves getLogs/getBlock fixtures — mint-labeled
   row, ordering, lazy single fetch, walletless note, RPC-decline
   note; no test touches the real network. Rollback: revert squash.

## Client review status

- [x] kwigbelle (single-lane feature; no cross-lane consumers)

## Downstream commitments

None.

## Progress log

- 2026-08-25 — Drafted after live probes (tooling + four public
  RPCs refuse full-range getLogs; wallet-provider path chosen).
  PR opened for panel review.
- 2026-08-25 — TAD merged (PR #22, three lite rounds; round-3
  Codex catch scoped Decision 4's locks to the spring-backed
  genes 5–11).
- 2026-08-25 — PR A implemented (Decisions 1–3, 6–7): info drawer
  with `SidePanel.addSection(title, element, drawerId)`, Traits
  moved, `Lib/InfoSections.js` rarity explainer, 3D `--bg` swap
  (with a resize-during-3D guard in refreshPreview), and the
  backdrop fix — which needed one step more than the TAD's
  slice-only prescription: a 100%-sized raster would still be
  stretched by drawImage, so the backdrop now rasterizes AT the
  display size with slice (layers keep meet). Suite 15/15 with
  the drawer-split re-pointing, explainer/3D-bg/mobile-backdrop
  assertions added.
- 2026-08-25 — Operator QA on PR A: the explainer ships collapsed
  by default (the panel store now records the user's choice in
  BOTH directions so an expand overrides the default), and the
  identity card moved out of Traits into its own Overview
  section; info-drawer order is How rarity works / Overview /
  Traits.
