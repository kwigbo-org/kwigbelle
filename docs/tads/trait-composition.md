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
| 2 | Fetch the full trait-art library **once** and commit it to the repo (`Traits/<generation>/<traitId>.svg` + `Traits/index.json`) | Trait art is effectively frozen (the mint completed years ago), though not strictly immutable — the ABI exposes `extendTraitArt` and a `TraitArtExtended` event. The committed library therefore records a per-fragment checksum, and `extract-traits.js --verify` re-runs extraction against fresh renders of the coverage set and diffs against the snapshot so staleness is detectable on demand. A committed library makes runtime independent of the heavy `renderAvastar` call and of RPC rate limits; a few hundred fragments, single-digit MB |
| 3 | Full-corpus render scraping is never the primary path. With `getTraitArtById` confirmed gated (Q1), the gated-read path is **Decision 7's coverage-set extraction**; the 26.6k full-render scrape survives only as Decision 7's deep fallback. A ~100-token held-out render sample is kept for byte-level validation of local composition | Fragment-level sourcing covers the whole corpus by construction at a small fraction of the fetch cost |
| 4 | Trait names/rarity come from the committed `Traits/index.json` (built from `getTraitInfoById`); `getAvastarMetadata` used only as a cross-check during validation | No per-token metadata calls at runtime |
| 5 | `AvastarParser` heuristic slicing is retained as a **runtime fallback** when trait composition fails (unknown generation, decode mismatch) | Graceful degradation; no regression for tokens the composer can't handle |
| 6 | Tooling is Node CLI in `Tools/`, RPC endpoint via `AVASTARS_RPC_URL` env var (free Alchemy/Infura key), resumable (skip files present on disk), sequential with backoff | Wallet RPCs aren't scriptable; keyless public RPCs refuse heavy calls; resumability makes reruns cheap |
| 7 | **(Amendment, post-Step-1)** The trait-art library is built by **coverage-set fragment extraction**, since `getTraitArtById` is role-gated (Q1): fetch all 26,617 trait hashes via batched `getPrimeByTokenId`/`getReplicantByTokenId` (cheap calls), select a minimal token set covering every (gene, variation) at least twice, fetch only those full renders (~hundreds of heavy calls), then extract per-trait fragments — each render's byte length is one linear equation `length = C + Σ len(fragment(gene_i, variation_i))` where `C` (the renderer's constant header+footer bytes) is itself a solved unknown alongside the ~700 fragment lengths; the header's own length is pinned separately by structural inspection of one render (locating the `<svg …>`/`</svg>` wrapper boundary) so solved lengths become cut offsets; fragments cut from different tokens sharing a trait must be byte-identical (built-in cross-validation). Full 26.6k render scrape demoted to deep fallback if extraction hits a non-concatenative renderer | Same committed `Traits/` endpoint at ~2% of the heavy-call cost; validation is intrinsic to the method rather than a separate sampling pass |

## Resolved Questions (Step 1 probe, 2026-08-21)

- **Q1 — RESOLVED: `getTraitArtById` is role-gated.** Live probe: reverts `Roles: account is the zero address` with no `from`, and `execution reverted` with a non-zero dummy `from` — a real caller role is required, so per-trait art is NOT publicly readable. However the rest of the read surface is open with zero-address `eth_call`: `getPrimeByTokenId`, `getTraitIdByGenerationGeneAndVariation`, `getTraitInfoById`, `getTraitNameById`, and `renderAvastar` (36,262 bytes for token 8014) all succeed. → Decision 3's contingency activates, redesigned as Decision 7 (coverage-set fragment extraction) — NOT the 26.6k full scrape.
- **Q2 — RESOLVED: byte-packed, one gene per byte, low byte = gene 0.** Token 8014's hash `0x…200c050c1503082434071104` decodes to variations `[4,17,7,52,36,8,3,21,12,5,12,32]` for genes 0–11; gene 0 variation 4 maps via `getTraitIdByGenerationGeneAndVariation(0,0,4)` → trait 3 → "Mellow Apricot" (a skin tone; gene 0 = skin tone, consistent). Note the `generation` value is the 0-based enum (Gen 1 = `0`). `totalSupply` = 26,617.

## Open Questions

All resolved during Step 2/3 implementation (2026-08-21):

- **Q3 — RESOLVED: replicants decode identically.** All 1,417 replicants fetched with the same byte-packing (no `series` field, as expected); held-out validation samples span primes and replicants.
- **Q4 — RESOLVED: defs live inside their gene's fragment.** Patterns, gradients, and `<defs>` are emitted within the owning gene's element run (e.g. `pattern id="nose_k"` inside the nose fragment). The composer needs no separate defs handling; the heuristic parser's cross-bucket defs risk (audit finding 3) is structurally absent in trait composition.
- **Q5 — RESOLVED: strict gene-id emission order.** Renders are the `<svg>` wrapper + four color `<style>` blocks (genes 0–3, one element each) + art fragments for genes 4–11 in gene-id order + `</svg>`. Verified by the exact-partition gate over the whole extraction corpus. Notable: trait art freely reuses OTHER genes' CSS classes (feature art styled with `hair_*` — the exact class-reuse that broke the heuristic parser), so class names must never be used for attribution; element ids/refs and emission order are the ground truth.

## Proposed design surface

```
Tools/fetch-hashes.js        node Tools/fetch-hashes.js
                             Batched over all 26,617 tokens (JSON-RPC batch,
                             cheap calls). Routing: getPrimeByTokenId reverts
                             on replicants (and vice versa), so primes are
                             tried first and revert-failures retried as
                             replicants - cheaper than a per-token
                             getAvastarWaveByTokenId pre-call. Writes
                             Tools/data/hashes.json
                             { tokenId: { traits, generation, gender,
                               ranking, kind, series? } }
                             series is PRIME-ONLY (getReplicantByTokenId has
                             no series output). Resumable; throttle-aware
                             (provider capacity errors retried with backoff).

Tools/extract-traits.js      node Tools/extract-traits.js
                             Selects a coverage set (every (gene, variation)
                             in >=2 tokens) from hashes.json, fetches those
                             renders via renderAvastar, solves per-trait
                             fragment lengths (linear system over render
                             lengths), cuts fragments, cross-validates
                             byte-identity across tokens sharing a trait,
                             fetches getTraitInfoById per trait, writes
                             Traits/<gen>/<traitId>.svg and Traits/index.json
                             { traitId: { gene, geneName, variation, rarity,
                               rarityName, name, series, gender, sha256 } }
                             gene/rarity come from the contract as uint8 enums;
                             geneName/rarityName are derived from a local
                             enum-to-string table in the tool, NOT fetched.
                             sha256 is the fragment checksum backing --verify
                             (staleness detection per Decision 2).

Tools/validate-composition.js  node Tools/validate-composition.js --sample 100
                             Held-out token sample (outside the coverage set):
                             compose locally from Traits/, fetch renderAvastar,
                             normalize + diff; writes report.

Lib/TraitComposer.js         class TraitComposer
                               async compose(tokenId)
                                 -> { layers: [{ svgString, traitId, name,
                                      gene, rarity }], backgroundColor }
                             Uses AvastarLoader's contract for
                             getPrimeByTokenId/getReplicantByTokenId, decodes
                             the hash, assembles per-trait layer SVGs from the
                             committed library (fetched relative URLs).

Lib/AvastarLoader.js         + getAvastarTraits(tokenId) -> { traits, generation,
                               gender, ranking, series? }  (thin contract
                               wrapper; series present for primes only)

Lib/MainScene.js             Layer pipeline consumes TraitComposer output when
                             available (per-trait layers, correct depth order),
                             falls back to AvastarParser otherwise. Gated by
                             ?traitcompose=0|1 during rollout (Step 4→5).
```

Explicitly **out of scope** for this TAD: trait panel UI (names/rarity display in the page), remix/frankenstar features. Those build on `TraitComposer` output and get their own TAD(s).

## Steps

1. **Access probe.** — **DONE 2026-08-21.**
   - *Action:* Minimal Node script calling `getPrimeByTokenId(8014)`, `getTraitIdByGenerationGeneAndVariation`, `getTraitInfoById`, `getTraitNameById`, `getTraitArtById`, `renderAvastar` via `AVASTARS_RPC_URL`.
   - *Result:* Metadata surface fully public; hash byte-packing confirmed (Q2 resolved); `getTraitArtById` role-gated (Q1 resolved) → Decision 7 contingency activated by amendment.
2. **Hash corpus + trait library extraction.** — **DONE 2026-08-21** (see Progress log).
   - *Action:* Build `Tools/fetch-hashes.js` (all 26,617 hashes, batched) and `Tools/extract-traits.js` (coverage set → renders → length-system solve → fragment cut → cross-validation → `Traits/` + index). Commit tools, `Traits/`, and `Tools/data/hashes.json`.
   - *Validate:* Linear system solves with zero residual (or deviations investigated — Q5); every fragment byte-identical across ≥2 source tokens; index covers every (gene, variation) present in the hash corpus; spot-open a dozen fragments in a browser; Q4 answered by inspection of extracted fragments.
   - *Rollback:* Delete `Traits/`, `Tools/` additions (single commit revert). If the renderer proves non-concatenative → deep fallback per Decision 7 (full-render scrape) via further amendment.
3. **Offline composition validation.** — **DONE 2026-08-21** (see Progress log).
   - *Action:* Implement decode + assembly in `TraitComposer`; compose the 8 bundled tokens + a 100-token held-out RPC sample; diff against `renderAvastar` output (normalized).
   - *Validate:* Byte-parity on the full held-out sample; Q3 answered (replicant decode) and documented via amendment.
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
- **2026-08-21** — Amended per panel review round 1 (PR #2): `geneName`/`rarityName` documented as locally derived, not contract outputs [sonnet]; Q1 reframed — `getTraitArtById` is `view`, `approveTraitAccess`/`useTraits` are the unrelated replicant-licensing writes [sonnet]; immutability claim qualified — `extendTraitArt` exists, so the committed library carries checksums + a `--verify` staleness check [codex]; Q2 strengthened with the `bool[12]` evidence [opus-4-7].
- **2026-08-21** — Panel round 2: 3/3 CLEAN at `e70d2a1`. Operator scope sign-off ("go") received; implementation began.
- **2026-08-21** — Amended per panel round 4: Decision 7's length system now includes the renderer's constant header+footer bytes `C` as a solved unknown, with the header length pinned structurally before offsets are cut [sonnet]; Decision 3 and Decision 2 cross-references updated to the post-amendment tool names and contingency [codex].
- **2026-08-21** — **Steps 2–3 executed.** Hash corpus: all 26,617 tokens (25,200 primes / 1,417 replicants, zero failures; `fetch-hashes.js` routes prime-first with revert-retry, throttle-aware batching under the Alchemy free-tier CU/s cap). Extraction (`extract-traits.js`) took 9 iterations to land — the working method is element-level (not the length-system Decision 7 sketched, which the element approach subsumes): tokenize each unwrapped render into top-level elements; seed per-gene CORE fragments via id/url gene tagging (574 seeds); Hamming-1 pair diffs add edge evidence; then an interleaved fixpoint of orphan split-repair, single-unknown propagation, and per-render reconciliation — with EVERY candidate validated by contiguous appearance in every carrier — until all renders partition exactly. Two boundary residuals (elements constant within the initial coverage set but not globally) were eliminated by absorbing failing validation renders as counterexamples; final corpus 209 renders, all partitioning byte-exactly. **Validation: five consecutive fresh held-out samples (~490 distinct tokens never used in extraction) reproduce on-chain `renderAvastar` output byte-for-byte with zero mismatches and zero missing traits.** Library committed: `Traits/0/<traitId>.svg` × 614 + `index.json` (name/gene/variation/rarity/gender/sha256) + `compose.json` (constant header/footer). Q3/Q4/Q5 resolved (see Resolved Questions). `totalSupply` 26,617. Q1 resolved: `getTraitArtById` role-gated (reverts for zero AND non-zero callers); all other reads public. Q2 resolved: hash is byte-packed per gene (token 8014 → variations `[4,17,7,52,36,8,3,21,12,5,12,32]`, gene 0 var 4 → trait 3 "Mellow Apricot"); generation enum is 0-based. **Amendment: Decision 7** replaces the full-scrape contingency with coverage-set fragment extraction; Steps 2–3 redefined accordingly; Q5 added (concatenation order). Awaiting panel re-review + operator re-sign-off on the amended scope before Step 2.
