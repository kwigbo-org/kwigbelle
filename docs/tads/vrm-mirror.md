# TAD: VRM mirror — back up all Avastar models to operator-owned storage and serve from it

- **Status:** IN REVIEW
- **Driver:** Operator (2026-08-25): "we need to get these vrms
  backed up so they don't disapear. That was a lot of hard work
  that noone is managing right now." Preceded by a live outage
  report ("3d model not available on 19449") whose diagnosis
  exposed the fragility below.

## Context

- **The VRMs are unmanaged.** Every Avastar has (per metadata) a
  `vrm_url` pointing into IPFS. Nobody pins them on the project's
  behalf; they persist only while some gateway/pinning service
  keeps them warm. The art is irreplaceable — the factory is
  closed and the team gone.
- **The public gateway pool has collapsed** (probed live
  2026-08-25): ipfs.io no longer serves CORS headers (curl works,
  every browser blocks), dweb.link's subdomain redirect 301s
  without CORS (browser-fatal), and 4everland / w3s.link /
  filebase / fleek / trustless-gateway / storry were unreachable
  or redirect-broken. **gateway.pinata.cloud is the ONE live
  lane**: full 10MB files in 3–6s, CORS `*`, but 3–8.5s first
  byte and transient failures. PR #24 added a one-round automatic
  re-race as a stopgap; the single point of failure remains.
- **Size** (8-token sample via pinata content-length): primes
  ~10.0–11.1MB, exclusive ~11.6MB, founders ~14.2–14.8MB. With
  25,000 primes dominating, corpus ≈ **280–295GB** across ≤26,617
  files. Token 26616 returned NO `vrm_url` — some late replicants
  may have no model; the capture must record gaps, not fail.
- **Filenames are derivable**: `Avastar_{Kind}_{id}.vrm` where
  Kind ∈ Founder/Exclusive/Prime/Replicant — exactly what
  `kindLabel(tokenId, kind)` (Lib/RarityIcons.js) computes from
  the hash corpus. A mirror keyed by filename needs NO metadata
  fetch to address.
- **The site's buckets**: deploy.sh pushes `build/` →
  `s3://kwigbelle-stage --delete` (`-s`) and syncs stage →
  `s3://kwigbelle --delete` + CloudFront invalidation (`-p`).
  Both `--delete` syncs would ERASE any bucket content that is
  not in the deploy tree — a mirror prefix must be excluded from
  both, or the first deploy after the upload destroys the backup.
- **Cost** (~285GB): S3 storage ≈ $6.50/mo; CloudFront egress
  ≈ $0.001 per 3D view (~10MB). One-time capture is bandwidth
  and wall-clock (order of 1–2 days through the one flaky
  gateway), not money.
- The operator's laptop has ~300GB free — too tight to stage the
  corpus locally (the estimate nearly equals it). Capture must
  stream through: download one, verify, upload, delete.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Mirror location**: `s3://kwigbelle/vrm/<filename>` — the production site bucket, under one prefix, uploaded directly (never via deploy.sh / ~/Sites / stage). Objects get `Content-Type: model/gltf-binary` and a long immutable `Cache-Control` (the corpus is frozen). | Operator: "pull and store with the rest of the site". One durable copy on 11-nines storage IS the backup; a prefix keeps it out of the deploy tree's way. |
| 2 | **Deploy guardrail** (ships BEFORE any upload): both `--delete` syncs in deploy.sh gain `--exclude "vrm/*"`, so neither a stage push nor a promote can delete or overwrite the mirror. | The wipe hazard is structural; the guardrail must land first or the first `-s`/`-p` after upload erases 285GB of backup. |
| 3 | **Capture tool** `Tools/mirror-vrms.js` (fetch-hashes/fetch-burned house pattern): for each token 0–26,616 — metadata → `vrm_url` (a missing one is recorded as a GAP, not an error), stream the bytes from the pinata gateway (retry with backoff), verify (glTF `glTF` magic + byte length equals the gateway's declared length), hash (sha256 while streaming), `aws s3 cp` to the mirror, delete the local temp. Sequential with modest throttle; RESUMABLE via a progress file — the run is expected to span days and be interrupted freely. Needs only the AWS CLI creds the operator already deploys with; no RPC. | Stream-through fits the 300GB laptop constraint; resume + retry fits the one flaky gateway; verification means the backup is known-good at write time, not discovered-bad later. |
| 4 | **Manifest** `Tools/data/vrm-manifest.json`, committed and `-diff`: `tokenId -> { file, size, sha256, cid }` plus the gap list. This is the durable integrity record — with it, any future copy of the mirror can be audited byte-for-byte, and the CID column preserves the original IPFS addressing even if the metadata endpoint dies. | The backup is only as good as the ability to PROVE it's intact. ~3–4MB of JSON is cheap insurance. |
| 5 | **Serving lane** (second PR): `VRMSource.fetchVRM` tries the mirror FIRST — one direct fetch of `https://kwigbelle.com/vrm/<filename>` (filename derived from the hash corpus via a kind lookup the scene wires in, so the happy path needs NO avastars.io metadata call) — and falls back to the existing metadata → hedged gateway race (with its PR #24 re-race) on any failure. Download VRM rides the same path. | CloudFront first = fast and self-owned; 3D survives even an avastars.io shutdown, same "outlive the infrastructure" doctrine as the trait library. The gateway race stays as the safety net. |
| 6 | **Cross-origin ops step** (one-time, CLI): a CORS policy on the `kwigbelle` bucket (GET, any origin) and a CloudFront CORS response-headers policy, so stage and local dev — different origins — can fetch the mirror. The absolute prod URL is the ONE mirror lane everywhere; stage stores no copy. | One copy, addressable from every environment; doubling 285GB into stage for symmetry would be pure cost. |
| 7 | **Trigger discipline**: the capture runs once, operator-invoked, resumable; `--verify N` re-downloads N random mirrored files and re-checks sha256 against the manifest. Re-runs skip completed tokens (progress file) so a crash or a new gap discovery costs nothing. | Same verification culture as fetch-burned/check-corpus. |
| 8 | Ships as two PRs: **PR A** — guardrail + capture tool + manifest schema (Decisions 1–4, 7); the multi-day capture run happens after PR A merges, feeding the manifest; **PR B** — serving lane + CORS ops step (5–6), landing once the mirror is populated and verified. | The backup is the urgent half and must not wait on serving design; serving without a populated mirror would 404 every fetch. |

## Proposed design surface

```
deploy.sh                 both sync commands: --exclude "vrm/*"
Tools/mirror-vrms.js      (new) capture: metadata -> pinata stream
                          -> verify -> sha256 -> s3 cp; resumable
                          progress file; --verify N audit mode;
                          gap ledger
Tools/data/vrm-manifest.json  committed integrity record (-diff)
Lib/VRMSource.js          fetchVRM: mirror-first lane (derived
                          filename), gateway race as fallback
Lib/MainScene.js          wires a kind lookup (hash corpus) into
                          VRMSource for filename derivation
```

## Steps

1. **PR A — guardrail + capture.** Action: Decisions 1–4, 7.
   Validate: a dry-run mode prints the first N planned uploads
   without touching S3; the verifier round-trips a small local
   fixture through the full stream-verify-hash path; deploy.sh's
   excludes eyeballed against `aws s3 sync` dry-runs. Rollback:
   revert squash (the tool is inert unless invoked).
2. **Capture run** (operator-triggered, days, resumable):
   populate the mirror + manifest; `--verify` sample afterwards;
   record the final count/gaps in this TAD's progress log.
3. **PR B — serving lane.** Action: Decisions 5–6. Validate:
   vrm-source-test grows mirror scenarios (mirror serves — no
   metadata request at all; mirror 404 → metadata + gateway
   fallback; mirror dead → fallback; abort covers both lanes);
   the ops step verified with a live cross-origin fetch from
   stage. Rollback: revert squash — the mirror stays a pure
   backup, gateways keep serving.

## Client review status

- [x] kwigbelle (single-lane feature; no cross-lane consumers)

## Downstream commitments

None.

## Progress log

- 2026-08-25 — Drafted after the gateway-collapse diagnosis (PR
  #24's re-race stopgap) and operator direction to back the
  corpus up into the site bucket. Size/cost estimated from an
  8-token sample; 26616 observed with no `vrm_url`. PR opened
  for panel review.
