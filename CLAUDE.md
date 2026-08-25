# kwigbelle

Interactive Avastars display site (kwigbelle.com). Static — no build
step, no framework: ES modules served as-is. An Avastar renders on a
canvas as independently-moving layers (spring physics, idle
breathing, pointer/tilt follow, tap-to-poke, wave/trails effects),
with a right-edge drawer stack: a profile drawer (wallet connect,
owned-Avastars grid with composed thumbnails, logout, presence dot)
above a settings drawer (load-any-token, effects controls, 3D model,
trait sheet with identity card, burned-trait marks, visibility
toggles, and a trait swap preview).

Project purpose (operator, 2026-08-22): jump-start interest in
Avastars. The replicant factory is CLOSED and the contract is
LOCKED — no new mints are possible, so the hash corpus (26,617) is
effectively frozen (check-corpus should always report fresh) and
everything trait-swap related is preview-only by nature, not just
by policy. Shipped directions, each frozen as a TAD in docs/tads/:
the VRM 3D viewer (vrm-viewer.md), the avastars.io design match
(design-cues.md), the profile drawer + composed thumbnails
(profile-drawer.md), and burned traits + effects + trait-card
polish (burned-traits.md). DECLARED NEXT (operator 2026-08-25):
docs/tads/info-tab.md — info drawer between profile and settings
(traits move there + rarity explainer + wallet-provider transfer
history), per-layer motion locks, depth-coherent idle retune, 3D
background fix, mobile backdrop squish fix; TAD in review at
compact time, implementation not started. Parked: PR #1 wallet
LOWs (likely mooted — WalletConnectUI was deleted in PR #16;
re-verify against ProfileSection before resurrecting).

## Architecture

```
index.html                 boots Lib/MainScene.js (module)
Lib/MainScene.js           scene: load orchestration + async-race
                           guards (the most delicate code in the
                           repo), render loop, ?param flags
Lib/LayerSprings.js        spring physics: per-depth params +
                           integration (idle breathing, follow,
                           poke impulses, wave pulse)
Lib/ProfileSection.js      profile drawer: wallet connect flow
                           (multi-wallet chooser, switch/link,
                           logout) + owned-Avastars grid w/ lazy
                           library-composed thumbnails
Lib/SidePanel.js           right-side drawer stack: stacked handle
                           tabs (profile above settings) sharing
                           one sliding column; settings sections
                           register via addSection(title, element)
Lib/LoadSection.js         load any Avastar by token id (walletless,
                           corpus-validated before loading)
Lib/TraitEditModal.js      per-slot trait chooser: true thumbnails
                           styled by the current colors, gender
                           filter; drives the swap preview
Lib/EffectsSection.js      spring-rig controls (motion, follow,
                           pause, wave, trails, tilt follow);
                           localStorage persisted; poke (tap
                           impulse) is always on, no control
Lib/TraitsSection.js       identity card (chips, score/tier, dist,
                           Unique-By, mint/burned) + trait cards
                           (whole-card tap = edit, burned marks,
                           visibility the render loop consults each
                           frame); goes read-only in 3D mode
Lib/VRMSource.js           metadata -> vrm_url -> hedged IPFS
                           gateway race (staggered starts, first
                           chunk wins, first-byte timeouts, CIDv0
                           -> v1 rewrite, progress, LRU cache)
Lib/VRMViewer.js           own-canvas three.js VRM display (orbit
                           controls, spring-bones, full disposal)
Lib/VRMSection.js          "3D model" panel section: view toggle +
                           owner-only Download VRM
Lib/VRMLoadingUI.js        center-screen VRM loading overlay
                           (tap-to-cancel) + failure toast; the
                           3D entry/exit lives in VRMSection
Lib/RarityIcons.js         tier icons/colors, score->tier bands,
                           kind labels (single design-token source)
Lib/UIHelpers.js           stopSceneEvents, svgToImage
Lib/vendor/                vendored libs (web3; three + three-vrm
                           ES modules wired by index.html's import
                           map) - never lint/format/edit
Lib/TraitComposer.js       THE render path: composes any of the
                           26,617 Avastars from Traits/ + the static
                           hash corpus - no wallet, no chain calls.
                           On failure MainScene degrades to a single
                           static full-render layer (retire-legacy
                           TAD); the old heuristic parser is GONE
Lib/AvastarLoader.js       wallet integration: EIP-6963 discovery,
                           chain guard, owned-token enumeration,
                           renderAvastar as fallback only (its last
                           on-chain render use)
Lib/Scene.js, DisplayLoop.js, Point.js, Size.js   small scene plumbing
Traits/                    committed trait library: 614 SVG fragments
                           (Traits/0/<traitId>.svg), index.json
                           (name/gene/variation/rarity/gender/sha256),
                           compose.json (constant header/footer),
                           extraction-tokens.json (evidence manifest)
Tools/fetch-hashes.js      all 26,617 trait hashes -> Tools/data/hashes.json
Tools/extract-traits.js    rebuilds Traits/ from a coverage corpus;
                           --verify checks staleness against the chain
Tools/validate-composition.js  held-out byte-parity vs renderAvastar;
                           --absorb feeds failures back as evidence
Tools/compute-ub.js        frozen Unique-By combo counts for the
                           lottery primes -> Tools/data/ub.json
Tools/fetch-burned.js      every prime's burned-trait flags (the
                           locked contract's bool[12], bit=gene) ->
                           Tools/data/burned.json (sparse masks);
                           --verify cross-checks chain + metadata
Tools/check-corpus.js      totalSupply vs hashes.json staleness;
                           --update refreshes; deploy.sh runs it
                           warn-only when AVASTARS_RPC_URL is set
Tests/                     headless-Chrome harness (see Tests/README.md)
SVG/                       8 bundled fallback Avastars (pretty-printed
                           saves; chain output is minified - compare
                           content, never bytes)
docs/tads/                 frozen TADs (design history)
feedback/                  gitignored operator progress log
```

URL flags: `?tokenid=N` (any token); `?testharness=1` (tests only —
exposes `window.kwigbelleScene` for physics assertions).

## Ground rules learned the hard way

- **Never attribute SVG art by CSS class** — trait art reuses other
  genes' classes (feature art styled `hair_*`). Element ids/refs and
  gene-id emission order are the ground truth (TAD Q5).
- **Traits/ is generated, never hand-edited.** Rebuild with
  `Tools/extract-traits.js`; integrity = sha256 in index.json +
  `--verify`. Marked `-diff` in .gitattributes so reviews stay
  readable.
- **`AVASTARS_RPC_URL`** (operator's ~/.zshrc; free Alchemy key) is
  tooling-only — the deployed site never uses it. Shell state doesn't
  persist between Bash calls; `source ~/.zshrc` before tooling runs.
  Free-tier caps compute units per SECOND; batch small, retry
  capacity errors (see fetch-hashes.js).
- Bump the `console.log("kwigbelle build ...")` stamp in MainScene.js
  with every deployable change — it's how running versions are
  identified in the browser console.
- During long autonomous work, keep `feedback/PROGRESS.md` updated —
  the operator reads it instead of chat scrollback.

## Risk-sensitive paths

- `deploy.sh` — recursive-wipe logic (WEB_PATH canonicalization +
  web-root heuristics). `~/Sites` is shared with the sibling kwigbo
  site by design.
- `Lib/AvastarLoader.js` / wallet flows — multi-wallet discovery,
  chain switching, connect prompts.
- `Traits/**` + `Tools/data/hashes.json` + `ub.json` — generated integrity-
  checked data.

## Testing

`Tests/` (see its README): headless Chrome + mocked EIP-1193/6963
providers; every PR is verified against it. On-chain parity lives in
`Tools/validate-composition.js`.

Style: `npm install` once at the repo root, then `npm run check`
(ESLint + Prettier). Local only — NO GitHub Actions/CI, operator
decision (cost). Run it before every PR alongside the Tests/ suite.
Frozen TADs and generated/vendored trees are excluded on purpose.

## Deploy

`./deploy.sh` local-only → `~/Sites`; `-w` also serves at
127.0.0.1:8000; `-s` stage; `-p` promote stage→prod + CloudFront
invalidation. deploy.sh must copy any new runtime asset (it ships
`Lib SVG favicon Traits Tools/data/hashes.json`, `ub.json`, and
`burned.json`).

## Shared rules across all project agents

For the code review and merge workflow that applies uniformly to
every agent in the kwigbo lane model, see the canonical doc:

- **`../agent-server-manager/CODE_REVIEW_PROCESS.md`** — relative
  path, resolves on the operator's Mac as
  `~/Desktop/Desktop/Git/agent-server-manager/...`.

Script invocations use `~/<script>.sh` (host-anchored via `$HOME`).

Quick reference (full nuance in the doc):

- PR creation IS the user approval — no separate "APPROVED" click required
- Project work starts with a TAD (operator policy 2026-08-21 for this
  repo) — see the TAD phase section in the canonical doc; merged TADs
  freeze as historical record in `docs/tads/`
- Reviewer path: local review only (`~/code-review.sh --pr <N>` —
  4-panel default sonnet+opus-4-7+opus-4-8+gpt-5.5 in fresh contexts;
  `--lite` opts down to 3-panel for routine/doc-only PRs). Run it
  from the repo root — it requires a git worktree cwd — immediately
  after EVERY push to an open PR head.
- Majority-vote marker; fix genuine minority catches as fix-pushes,
  don't amend code just to silence a dissent
- Iteration discipline: small=1 round, medium=2, large=until
  convergence; cut off when remaining findings are non-load-bearing
- Merge gates (all must hold): base `main`, head `develop`, threads
  resolved, STATUS:CLEAN at headRefOid, mergeable+CLEAN — then
  `~/merge-pr.sh <N>`
- Push to `develop` only; `main` updated via squash-merged PRs;
  merge-pr.sh resets develop from main afterward
- Large generated-asset diffs: mark `-diff` in .gitattributes or the
  panel reviewers crash and the review body blows GitHub's 64KB cap

Re-read the canonical doc whenever the user references a specific
clause; it is the source of truth.
