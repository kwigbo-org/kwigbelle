# TAD: profile drawer (wallet + owned Avastars) and composed picker thumbnails

- **Status:** IMPLEMENTED (2026-08-24: TAD PR #15, drawer PR #16,
  composed thumbnails PR #17) — frozen as historical record.
  (Post-freeze note: the Decision 5 badge later became an
  always-visible grey/green presence dot, shipped and recorded
  under docs/tads/burned-traits.md, 2026-08-25.)
- **Driver:** Operator (2026-08-24): "I want a second tab above
  settings on the right. It will be a profile icon. We will put the
  connect wallet button in this drawer and your avastars. Also, we
  can ditch the lower left 3d button since that UI is duplicated in
  the settings drawer." This absorbs the previously-parked "composed
  picker thumbnails" follow-up — the picker gets rebuilt anyway, so
  its thumbnails switch from on-chain renders to library composition
  in the same effort.

## Context

Current screen layout (all positions verified in `style.css` and the
Lib classes on 2026-08-24):

- **Top-left:** `#walletConnect` (WalletConnectUI — connect /
  switch-network button + multi-wallet chooser) and
  `#avastarPicker` (PickerUI — collapsed current-token thumbnail
  that expands into the owned list). Both float over the art.
- **Top-right:** `#sidePanel` — single ⚙ handle sliding out the
  settings column (Load / Effects / 3D model / Traits sections).
- **Bottom-left:** `#viewToggle` (ViewToggleUI — 3D/2D toggle,
  fetch progress, tap-to-cancel) plus `#viewToggleError` toast and
  the centered `#vrmLoading` overlay whose hint reads "Tap the 3D
  button to cancel".

Duplication facts driving the 3D-button removal: VRMSection (the
"3D model" panel section) already exposes the full toggle surface —
"View in 3D" / "Cancel loading" / "Back to vector" plus a progress
line — and the centered overlay already carries phase + progress.
The floating button's only non-duplicated roles are (a) the cancel
affordance named by the overlay hint and (b) an always-visible exit
while in 3D. (a) moves onto the overlay itself; (b) is accepted as
one extra tap (the settings drawer remains accessible in 3D and is
where the user just came from).

Thumbnail facts: PickerUI thumbnails come from
`AvastarLoader.renderTokenSVG` — one `renderAvastar` wallet RPC
round-trip per owned token, serialized "to keep the wallet RPC
happy". This is the last heavy on-chain render path in the site.
`TraitComposer.compose(tokenId, displaySize)` already builds any of
the 26,617 tokens from the committed `Traits/` library with zero
network; the trait modal's bbox-crop technique produces styled
thumbnails from the same fragments. `renderTokenSVG` itself stays —
`fallbackSVG` still uses it as the wallet-connected fallback for the
main display when composition fails.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Two stacked handles on the right edge — profile above settings — sharing one sliding-drawer mechanism; opening one closes the other. | Operator directive ("second tab above settings"). One mechanism keeps the slide/backdrop behavior consistent and avoids two panels fighting for the same edge. |
| 2 | SidePanel generalizes to named drawers: the existing class grows a handle stack and per-drawer content columns; the settings drawer keeps its current DOM ids (`#panelSections`, `.panelSection`) so section code and tests stay stable. | Smallest refactor that supports two drawers; existing sections register exactly as before via `addSection`. |
| 3 | Profile drawer contents by wallet state: (no wallet detected) a short note; (wallet, not connected) the Connect Wallet button and, when several wallets are installed, the chooser rows; (wrong network) the Switch to Mainnet button; (connected) short address line + owned-Avastars grid. WalletConnectUI's flow logic moves in wholesale — connect semantics are unchanged. | The drawer is the one place wallet state lives; every state has a visible home instead of a button that appears/disappears over the art. |
| 4 | The owned grid replaces PickerUI: tap a token to load it; the current token is highlighted; picking closes the drawer so the load is visible. The top-left collapsed "current avastar" thumbnail is retired — current identity already lives in the Traits identity card. | Clears the art area entirely on the left; drawer-close-on-pick shows the result of the tap. |
| 5 | Profile handle shows a small accent badge when a wallet is connected. | Wallet state visible without opening the drawer. |
| 6 | BOTH handle icons are inline SVG glyphs at one shared size (30px), colored via currentColor. (Amended during PR A: the draft kept the ⚙ text glyph, but operator QA found mobile platforms substitute their color emoji for it and the mismatched sizes bloated the tabs.) | Emoji render with platform color and clash with the dark chrome; inline SVG obeys `--text` everywhere. |
| 7 | The floating 3D/2D button and its side toast are removed. The centered loading overlay survives (renamed home: VRMLoadingUI), becomes tap-to-cancel (pointer-events on, hint "Tap to cancel"), and pipeline errors surface as a transient bottom-center toast in the same visual style. | Operator directive; the panel's VRMSection already duplicates toggle/cancel/progress. The overlay is a larger, more discoverable cancel target than the old button. |
| 8 | Exit from 3D is VRMSection's "Back to vector" only. | Accepted UX cost (one extra tap); the user necessarily used that drawer to enter 3D. `beginLoad`'s exit3D choke point is untouched. |
| 9 | Grid thumbnails are composed from the `Traits/` library (full-figure, one static SVG per token via a small TraitComposer helper), rendered lazily as the grid scrolls/opens and cached per session. On per-token composition failure the tile keeps its token-id text label (current PickerUI fallback behavior). | Instant, walletless, zero RPC; retires the picker's `renderTokenSVG` dependency — the last heavy on-chain render use. |
| 10 | Ships as two code PRs against this one TAD: **PR A** — drawer restructure + wallet/picker move + 3D-button removal (thumbnails still on the old render path inside the new grid); **PR B** — composed thumbnails swapped into the grid. | Each panel review lands on one concern; PR A is UI plumbing, PR B is render-path correctness. |
| 11 | No new URL flags, no new network calls. Remembered-wallet persistence (`kwigbelle.wallet`) and effects persistence are untouched; the one storage addition is the `kwigbelle.disconnected` logout flag of Decision 12 (amended during PR A). | Scope discipline. |
| 12 | (Operator addition during PR A QA) The connected profile header carries a logout button — door-with-arrow icon, upper right, opposite the address. It clears the grid and ownership gates (Download VRM hides), forgets `kwigbelle.wallet`, sets `kwigbelle.disconnected` so a reload does NOT silently reconnect, and returns the drawer to Link Wallet; a connect tap clears the flag. | Pages cannot revoke a wallet extension's authorization, so logout is site-side state; without the flag the silent enumeration would undo it on the next reload. |

## Proposed design surface

```
Lib/SidePanel.js
  constructor(rootContainer)
  addDrawer(id, handleContent) -> drawer handle registered top-down;
      returns a content column element. Opening a drawer closes the
      other. Settings drawer keeps id #panelSections.
  addSection(title, element)   -> unchanged, targets the settings
      drawer (back-compat).
  open(id) / close()           -> programmatic control (pick-to-close,
      tests).

Lib/ProfileSection.js (new)    -> owns the profile drawer content:
  setWalletState(state)        -> "none" | "disconnected" | "wrongNetwork"
                                  | "connected"
  buildGrid(tokenIds)          -> owned grid (PR A: renderTokenSVG
                                  thumbnails; PR B: composed)
  setCurrent(tokenId)          -> highlight
  callbacks: onConnectTap, onWalletChosen, onPick
  (absorbs WalletConnectUI's connectWallet/toggleWalletChooser/
   continueConnect flow logic unchanged; PickerUI and
   WalletConnectUI are deleted)

Lib/VRMLoadingUI.js (renamed from ViewToggleUI, button removed)
  setMode / setProgress / setPhase  -> unchanged semantics
  showError(message)                -> bottom-center transient toast
  overlay tap                        -> onCancel callback

Lib/TraitComposer.js
  composeSVG(tokenId)          -> full minified SVG string for one
                                  token (thumbnail surface, PR B);
                                  reuses picksFor + the existing
                                  header/footer assembly.

Lib/MainScene.js
  wallet wiring targets ProfileSection instead of
  WalletConnectUI/PickerUI; toggle3D wiring drops the button and
  keeps VRMSection + overlay paths; build stamp bumped per PR.
```

## Steps

1. **SidePanel drawer generalization + profile drawer shell (PR A).**
   Action: `addDrawer`, handle stack CSS, profile handle + badge;
   move WalletConnectUI flow + picker grid into ProfileSection;
   delete PickerUI/WalletConnectUI; MainScene rewiring; drawer
   styles. Validate: full Tests/ suite with picker/chooser/eip/
   switch/failure tests updated to the drawer selectors; manual
   `./deploy.sh -w` pass across all four wallet states. Rollback:
   revert the PR (squash-merge makes this one commit).
2. **3D button removal (PR A, same branch).** Action: ViewToggleUI →
   VRMLoadingUI (button + side toast removed, overlay tap-to-cancel,
   bottom toast); MainScene toggle3D/setVRMMode wiring; hint copy.
   Validate: vrm-viewer-test / vrm-panel-test updated (enter via
   panel button, cancel via overlay tap, exit via Back to vector);
   manual 3D round-trip. Rollback: same PR revert.
3. **Composed thumbnails (PR B).** Action: `composeSVG` helper;
   ProfileSection grid renders through it (lazy, cached, id-label
   fallback); picker no longer calls `renderTokenSVG`. Validate:
   grid renders for a mocked wallet WITHOUT any `renderAvastar`
   eth_call (assert on the mock's call log); spot-check thumbnails
   vs the same tokens' main renders; suite green. Rollback: revert
   PR B — PR A's grid still works on the old path.

## Client review status

- [x] kwigbelle (single-lane feature; no cross-lane consumers)

## Downstream commitments

None — no other repo consumes these surfaces.

## Progress log

- 2026-08-24 — TAD drafted; PR #15 opened for panel review.
- 2026-08-24 — Panel CLEAN 3/3 round 1 (lite, doc-only); merged as
  `4429c5f`.
- 2026-08-24 — Steps 1–2 applied (PR A): SidePanel generalized to a
  drawer stack (addDrawer/open/close/isOpen/setBadge; settings
  drawer created lazily by addSection keeping `#panelSections` and
  `#panelHandle` ids); ProfileSection absorbs the WalletConnectUI
  flow + the grid (lazy thumbnails on drawer open, `data-token`
  tile attributes, connected-empty "No Avastars" note; PickerUI and
  WalletConnectUI deleted); ViewToggleUI became VRMLoadingUI
  (button + side toast gone, overlay tap-to-cancel with "Tap to
  cancel" hint, bottom-center failure toast). One addition beyond
  the letter of Decision 3: the authorized-on-mainnet-but-zero-
  Avastars wallet now also shows as connected (previously nothing
  rendered). Full 14-test suite green after harness rework
  (picker-test rewritten against the drawer; chooser/switch/eip/
  failure/panel/vrm-viewer tests updated; vrm-panel-test needed no
  changes).
- 2026-08-24 — PR #16 review round 1: CLEAN 3/4; sonnet's genuine
  minority MEDIUM (silent rejection paths in the moved connect
  flow, pre-existing from WalletConnectUI) fixed with per-arm
  try/catch + logged returns. Round 2: CLEAN 4/4.
- 2026-08-24 — Operator QA on PR A: (1) icon sizes mismatched and
  the ⚙ text glyph rendered as color emoji on mobile → Decision 6
  amended, both tabs now share one 30px currentColor SVG size;
  (2) logout button requested → Decision 12 added (with the
  Decision 11 truth-fix for its `kwigbelle.disconnected` flag).
- 2026-08-24 — PR #16 rounds 3–4: round 3 CLEAN 3/4 with a genuine
  Codex LOW (logout cleared `currentTokenId`, so a same-token
  reconnect rebuilt the grid unhighlighted) → preserved; round 4
  CLEAN 4/4. Operator QA +1; merged as `4a6efdc`.
- 2026-08-24 — Step 3 applied (PR B / PR #17): TraitComposer gains
  `composeSVG(tokenId)` (the fullSVG assembly without layer
  rasterization); the grid thumbnails render through it — zero
  wallet RPC, asserted in picker-test via a renderAvastar call
  counter pinned at 0. Byte parity of the assembly vs the chain
  render is already covered by compose-test, so the thumbnails
  inherit it. `renderTokenSVG` survives only as fallbackSVG's
  wallet fallback.
