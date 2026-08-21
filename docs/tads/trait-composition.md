# TAD — Trait-Derived Layer Composition

**Status:** Draft — pre-implementation review
**Repo:** `kwigbo-org/kwigbelle` · **Author session:** 2026-08-21 · **Follows:** PR #1 (spring physics + wallet picker)

## Context

An audit of `Lib/AvastarParser.js` (2026-08-21, against the 8 bundled SVGs run through the live parser with `parserdebug`) found the heuristic layer slicing structurally unreliable:

1. **Unknown vocabulary collapses the slicer.** Ids/classes outside the hard-coded `searchLayers` lists fail every bucket; once the bucket index runs past the array end, every subsequent node becomes its own layer (observed live on a helmet-trait Avastar; motivated the depth-normalization patch in PR #1, which masks the symptom only).
2. **Shared classes silently merge buckets.** Token 25495 parses into a 54-node "mouth" bucket because its facial-feature art reuses `skin_*` classes and never triggers the bucket advance. The `feat` bucket is empty on all 8 bundled tokens — feature art never lands where intended.
3. **`this.gradients` / `this.patterns` are referenced in `pathsToLayer` but never populated.** Gradients and patterns (20–38 per file) survive splitting only when their `<defs>` happen to slice into the same bucket as their consumers. No guarantee across the full corpus.
4. Smaller: `nodeContents` moves nodes out of the parsed document; no `parsererror` handling; `resize()` re-parses per event; substring class matching is collision-prone.

The Avastars contract removes the need for the heuristic entirely: `getPrimeByTokenId`/`getReplicantByTokenId` return the token's `traits` hash, and `getTraitIdByGenerationGeneAndVariation` → `getTraitInfoById` / `getTraitArtById` yield each trait's name, gene, rarity, and **exact SVG fragment**. `renderAvastar` output is the concatenation of those fragments — so layer boundaries are knowable per trait rather than guessed.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Derive layers from on-chain trait data (trait hash → per-trait art fragments) instead of heuristic slicing | Fixes audit findings 1–3 at the root; each layer becomes a named trait at its correct depth |
| 2 | Fetch the full trait-art library **once** and commit it to the repo (`Traits/<generation>/<traitId>.svg` + `Traits/index.json`) | Trait art is immutable on-chain; a committed library makes runtime independent of the heavy `renderAvastar` call and of RPC rate limits. Library is a few hundred fragments, single-digit MB |
| 3 | The 25.5k-token full-render scraper is a **contingency only** (activated iff `getTraitArtById` reads are access-gated); a ~100-token render sample is kept for byte-level validation of local composition | Trait-art-first covers the whole corpus by construction at ~1/250th the fetch cost |
| 4 | Trait names/rarity come from the committed `Traits/index.json` (built from `getTraitInfoById`); `getAvastarMetadata` used only as a cross-check during validation | No per-token metadata calls at runtime |
| 5 | `AvastarParser` heuristic slicing is retained as a **runtime fallback** when trait composition fails (unknown generation, decode mismatch) | Graceful degradation; no regression for tokens the composer can't handle |
| 6 | Tooling is Node CLI in `Tools/`, RPC endpoint via `AVASTARS_RPC_URL` env var (free Alchemy/Infura key), resumable (skip files present on disk), sequential with backoff | Wallet RPCs aren't scriptable; keyless public RPCs refuse heavy calls; resumability makes reruns cheap |

## Open Questions

- **Q1 — Is `getTraitArtById` publicly callable?** The ABI includes `approveTraitAccess`/`useTraits` (on-chain composition licensing); whether plain `eth_call` reads are gated is unverified (sandbox RPC probes were inconclusive). Resolved by Step 1. If gated → contingency in Decision 3.
- **Q2 — Trait hash packing layout.** Gen 1 has 12 gene slots; the exact bit/byte packing of `traits` (uint256) per generation must be verified by decoding known tokens against their rendered SVGs and `getAvastarMetadata` output. Resolved by Step 3.
- **Q3 — Replicants.** Confirm `getReplicantByTokenId` hash decodes identically (no `series` field).
- **Q4 — Do trait fragments carry their own `<defs>`** (gradients/patterns/styles), or do shared defs live in a wrapper `renderAvastar` adds? Determines what the composer must inject per layer. Resolved by Step 2 inspection + Step 3 diffing.

## Proposed design surface

```
Tools/fetch-traits.js        node Tools/fetch-traits.js [--generation 1]
                             Enumerates (generation × gene × variation) via
                             getTraitIdByGenerationGeneAndVariation, fetches
                             getTraitInfoById + getTraitArtById, writes
                             Traits/<gen>/<traitId>.svg and Traits/index.json
                             { traitId: { gene, geneName, variation, rarity,
                               rarityName, name, series, gender } }

Tools/validate-composition.js  node Tools/validate-composition.js --sample 100
                             Random token sample: compose locally from Traits/,
                             fetch renderAvastar, normalize + diff; writes report.

Lib/TraitComposer.js         class TraitComposer
                               async compose(tokenId)
                                 -> { layers: [{ svgString, traitId, name,
                                      gene, rarity }], backgroundColor }
                             Uses AvastarLoader's contract for
                             getPrimeByTokenId/getReplicantByTokenId, decodes
                             the hash, assembles per-trait layer SVGs from the
                             committed library (fetched relative URLs).

Lib/AvastarLoader.js         + getAvastarTraits(tokenId) -> { traits, generation,
                               series, gender, ranking }  (thin contract wrapper)

Lib/MainScene.js             Layer pipeline consumes TraitComposer output when
                             available (per-trait layers, correct depth order),
                             falls back to AvastarParser otherwise. Gated by
                             ?traitcompose=0|1 during rollout (Step 4→5).
```

Explicitly **out of scope** for this TAD: trait panel UI (names/rarity display in the page), remix/frankenstar features. Those build on `TraitComposer` output and get their own TAD(s).

## Steps

1. **Access probe.**
   - *Action:* Minimal Node script calling `getPrimeByTokenId(8014)` and `getTraitArtById` for one known trait id via `AVASTARS_RPC_URL`.
   - *Validate:* Fragment string returns; matches art visible in bundled `SVG/Avastar-8014.svg`.
   - *Rollback:* None (read-only). If gated: mark Q1 gated, amend TAD to activate the Decision-3 contingency (full-render scraper) before proceeding.
2. **Trait library fetch.**
   - *Action:* Build `Tools/fetch-traits.js`; run for all generations; commit `Traits/`.
   - *Validate:* Index count consistent with enumeration (no gaps besides nonexistent variations); spot-open a dozen fragments in a browser; Q4 answered by inspection.
   - *Rollback:* Delete `Traits/` + tool (single commit revert).
3. **Hash decode + offline composition.**
   - *Action:* Implement decode in `TraitComposer`; compose the 8 bundled tokens + a 100-token RPC sample offline; diff against `renderAvastar` output (normalized).
   - *Validate:* Byte-parity (modulo whitespace/ordering the renderer adds) on the full sample; Q2/Q3 answered and documented in this TAD's Decisions via amendment.
   - *Rollback:* Tool-side only; no runtime change yet.
4. **Runtime integration behind flag.**
   - *Action:* Wire `TraitComposer` into `MainScene` behind `?traitcompose=1`; extend the headless harness (mock provider returns hash; composer hits local `Traits/`).
   - *Validate:* Visual parity vs default path on bundled 8 + operator's wallet tokens; regression suite green.
   - *Rollback:* Flag stays opt-in; remove flag branch.
5. **Flip default, keep parser fallback.**
   - *Action:* Default to trait composition; `AvastarParser` used only on composer failure (console-warn when falling back). Update `deploy.sh` copy list for `Traits/`.
   - *Validate:* Full regression + operator QA on mainnet wallet; fallback path exercised via a forced-failure test.
   - *Rollback:* Revert the flip commit (flag machinery from Step 4 still present).

## Client review status

No cross-lane consumers — kwigbelle is a leaf lane; no other agent consumes its surfaces.

- [x] (none applicable)

## Downstream commitments

None.

## Progress log

- **2026-08-21** — TAD drafted from the AvastarParser audit + ABI analysis (this session). Sandbox RPC probes inconclusive on Q1; avastars.io confirmed alive (HTTP 200), `media.avastars.io` unresolvable from the audit environment.
