# kwigbelle

Interactive Avastars display site (kwigbelle.com). Static — no build
step, no framework: ES modules served as-is. An Avastar renders on a
canvas as independently-moving layers (spring physics, idle
breathing, pointer follow), with a wallet picker for owned tokens.

## Architecture

```
index.html                 boots Lib/MainScene.js (module)
Lib/MainScene.js           scene: load orchestration + async-race
                           guards (the most delicate code in the
                           repo), render loop, ?param flags
Lib/LayerSprings.js        spring physics: per-depth params +
                           integration (idle breathing, follow)
Lib/PickerUI.js            owned-Avastars picker overlay
Lib/WalletConnectUI.js     wallet button, multi-wallet chooser,
                           connect/switch flow
Lib/SidePanel.js           right-side collapsible panel; sections
                           register via addSection(title, element)
Lib/LoadSection.js         load any Avastar by token id (walletless,
                           corpus-validated before loading)
Lib/EffectsSection.js      spring-rig controls (explode, motion,
                           follow, pause); localStorage persisted
Lib/TraitsSection.js       per-layer trait rows + visibility the
                           render loop consults each frame
Lib/UIHelpers.js           stopSceneEvents, svgToImage
Lib/vendor/                vendored minified libs (web3) - never
                           lint/format/edit
Lib/TraitComposer.js       THE render path: composes any of the
                           26,617 Avastars from Traits/ + the static
                           hash corpus - no wallet, no chain calls.
                           On failure MainScene degrades to a single
                           static full-render layer (retire-legacy
                           TAD); the old heuristic parser is GONE
Lib/AvastarLoader.js       wallet integration: EIP-6963 discovery,
                           chain guard, owned-token enumeration,
                           renderAvastar for thumbnails + fallback
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

URL flags: `?tokenid=N` (any token), `?explode=1`.

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
- `Traits/**` + `Tools/data/hashes.json` — generated integrity-
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
`Lib SVG favicon Traits Tools/data/hashes.json`).

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
