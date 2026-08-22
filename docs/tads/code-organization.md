# TAD: Code organization & style tooling

- **Status:** IMPLEMENTED (2026-08-22, PR #4) — frozen as
  historical record
- **Driver:** Operator wants to move to new features on organized
  ground: "I want styles and code organized." Constraint: **no
  GitHub Actions / paid CI** — everything runs locally.

## Context

The macro-structure (Lib/Tools/Tests/Traits/docs) is sound, but:

- `Lib/MainScene.js` (658 lines) is a god file carrying five jobs:
  load orchestration + async-race guards, spring physics, picker UI,
  wallet-connect UI, legacy parse glue.
- Vendored minified libraries (`web3.min.js` 2MB, `css.min.js`) sit
  beside first-party code in `Lib/`.
- No linter or formatter; style is reviewer-enforced only.

## Decisions

1. **Module split, behavior-identical.** MainScene keeps
   orchestration (initialLoad/beginLoad/finishLoad/resize/render)
   and the legacy parse glue. Extracted:
   - `Lib/PickerUI.js` — thumbnail + owned-token list. Talks to the
     scene through one callback (`onPick(tokenId)`); reads the
     loader for thumbnails/current SVG.
   - `Lib/WalletConnectUI.js` — connect button + multi-wallet
     chooser + connect flow (reentrancy guard, mainnet switch).
     Reports success through `onConnected(ownedTokenIds)`.
   - `Lib/LayerSprings.js` — spring parameterization + integration.
     The render loop asks it to `step()` and reads positions.
   - `Lib/UIHelpers.js` — `stopSceneEvents`, `svgToImage` (shared).
     The async-race machinery (loadGeneration, requestedTokenId,
     captured-size guards) stays in MainScene untouched — it is the
     most delicate code in the repo and this TAD deliberately does
     not redesign it.
2. **Vendor isolation.** `Lib/vendor/` for `web3.min.js` and
   `css.min.js`; `index.html` script tags updated. `deploy.sh`
   copies `Lib` recursively, so no deploy change is needed.
3. **ESLint (flat config) + Prettier, local only.** Root
   `package.json` (private, devDeps only) with `npm run lint` /
   `npm run format` / `npm run check`. Ignores: `Lib/vendor/`,
   `Traits/`, `SVG/`, `Tools/data/`, `build/`, `Tests/node_modules/`.
   Prettier: tabs (existing style), defaults otherwise. ESLint:
   `@eslint/js` recommended; browser globals for `Lib/`, node
   globals for `Tools/` + `Tests/`; `Web3`/`cssjs` as page globals.
   No CI — `npm run check` is part of the pre-PR checklist next to
   the Tests/ suite (documented in CLAUDE.md).
4. **Not in scope:** picker-thumbnail composition (own TAD),
   `checkJs`/JSDoc type checking (possible later TAD), any physics
   or UX change.

## Verification

- Full `Tests/` suite green (7/7, enforced assertions) after the
  split — the suite covers picker, chooser, switch, EIP-6963,
  compose, failure, and smoke paths end to end.
- `npm run check` clean.
- Build stamp bumped so the running version is identifiable.

## Consequences

- Future feature TADs (trait panel, composed thumbnails, remix)
  land in focused files instead of growing the god file.
- `node_modules/` appears at the repo root (gitignored);
  `package-lock.json` is committed.
