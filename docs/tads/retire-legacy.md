# TAD: Retire the legacy parser path; corpus freshness check

- **Status:** IMPLEMENTED (2026-08-22, PR #5)
- **Driver:** Operator: "legacy was just my kind of hacky attempt at
  ripping into the svgs... fully embracing and fine tuning the new
  system is better than keeping the legacy around." Plus: "Is there
  a way I could setup a script to periodically check and update"
  the hash corpus for hypothetical new mints.

## Context

Trait composition (docs/tads/trait-composition.md) is the proven
render path: byte-parity vs renderAvastar across the corpus. The
legacy path — AvastarParser's heuristic slicing of a full render,
known unsound since the parser audit — survives only as the
automatic fallback and the `?traitcompose=0` opt-out. Every new
feature pays a "what about the legacy path?" tax (first example:
the upcoming side panel's Traits section has no trait metadata on
legacy layers). The two failure cases legacy covers are: partial
static-asset deploy (operator: unlikely) and tokens minted after
the hash snapshot (addressed by the freshness check below).

## Decisions

1. **Delete the legacy slicer.** Remove `Lib/AvastarParser.js`,
   `Lib/vendor/css.min.js` (its only consumer) + its index.html
   script tag, `parseAvastarSVG`, and the `?parserdebug` /
   `?traitcompose` URL flags. The wallet's legacy full-render main
   display path (`loadToken`/`loadOnChainAvastarSVG`) goes with it;
   `renderTokenSVG` stays (picker thumbnails, until the composed-
   thumbnail TAD).
2. **Composition failure degrades to a single static layer, not a
   dead spinner.** On compose() rejection: fetch a fallback SVG —
   the token's on-chain render when a wallet is connected, else a
   bundled `SVG/` Avastar — and display it as ONE full-canvas layer
   riding one spring (depth 0), so the site stays alive and gently
   breathing. Background color comes from the same
   `.bg_color{fill:#...}` regex TraitComposer uses. A console.warn
   ("using static fallback") remains the observable signal.
3. **The async-race machinery is preserved, not redesigned.**
   loadGeneration / requestedTokenId / captured-size guards keep
   their exact semantics; only the fallback arm inside beginLoad
   changes (loadFunction+parse becomes fetch-SVG+single-layer).
   Every guard is re-verified by the Tests/ suite.
4. **Corpus freshness: `Tools/check-corpus.js`.**
   - Default: one `totalSupply` eth_call vs the hashes.json entry
     count; prints fresh/stale and exits nonzero when stale.
   - `--update`: runs the (already resumable) fetch-hashes flow for
     the missing ids, then reminds the operator to run
     validate-composition on the new ids and redeploy.
   - `deploy.sh` runs the check WARN-ONLY before pushing when
     `AVASTARS_RPC_URL` is set (deploys must still work offline;
     the deployed site itself never uses the RPC).
   - No daemon/cron by default: a stale corpus only matters at
     deploy time, so deploy is the natural checkpoint. (A launchd
     periodic run stays possible later; out of scope.)
5. **Kept:** `SVG/` bundled Avastars (instant fallback data + test
   fixtures), `Tools/` extraction pipeline (rebuilds the library),
   the extraction TAD (history explaining where Traits/ came from).

## Verification

- Tests/ suite updated: compose-test's `?traitcompose=0` leg is
  replaced by a forced-failure check asserting the single-layer
  static fallback (drawn + warn, no page errors); all other tests
  must stay green unchanged.
- `npm run check` clean; build stamp bumped.
- check-corpus.js exercised against the live RPC (expect "fresh").

## Consequences

- The side panel (next TAD) needs no legacy-disabled states.
- ~600 lines of unsound/vendored code deleted; one render path to
  fine-tune.
- If composition ever fails in the wild, the display is static
  until fixed — accepted; the warn + freshness check make the
  cause findable.
