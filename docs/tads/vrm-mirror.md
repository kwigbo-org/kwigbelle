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
| 3 | **Capture tool** `Tools/mirror-vrms.js`, COMMITTED like the other one-shot capture tools (fetch-hashes/fetch-burned/compute-ub house pattern): for each token 0–26,616 — metadata → `vrm_url` (a missing one is recorded as a GAP, not an error), stream the bytes from the pinata gateway (retry with backoff), verify (glTF `glTF` magic + byte length equals the gateway's declared length), hash (sha256 while streaming), `aws s3 cp` to the mirror, delete the local temp. Sequential with modest throttle; RESUMABLE via a machine progress file — the run is expected to span days and be interrupted freely. The destination is a PARAMETER (default `s3://kwigbelle/vrm/`), so anyone with the repo and their own bucket can replicate the backup — redundant community copies are the point of preserving unmanaged art. Needs only the AWS CLI creds the operator already deploys with; no RPC. | Stream-through fits the 300GB laptop constraint; resume + retry fits the one flaky gateway; verification means the backup is known-good at write time. In-repo (operator question, resolved 2026-08-25): the tool is the manifest's PROVENANCE, the `--verify` audit needs it long after the run, and a committed tool lets others replicate the backup. |
| 4 | **Manifest** `Tools/data/vrm-manifest.json`, committed and `-diff`: `tokenId -> { file, size, sha256, cid }` plus the gap list. This is the durable integrity record — with it, any future copy of the mirror can be audited byte-for-byte, and the CID column preserves the original IPFS addressing even if the metadata endpoint dies. | The backup is only as good as the ability to PROVE it's intact. ~3–4MB of JSON is cheap insurance. |
| 5 | **Serving lane** (second PR): `VRMSource.fetchVRM` tries the mirror FIRST — one direct fetch of `https://kwigbelle.com/vrm/<filename>` (filename derived from the hash corpus via a kind lookup the scene wires in, so the happy path needs NO avastars.io metadata call) — and falls back to the existing metadata → hedged gateway race (with its PR #24 re-race) on any failure. Download VRM rides the same path. | CloudFront first = fast and self-owned; 3D survives even an avastars.io shutdown, same "outlive the infrastructure" doctrine as the trait library. The gateway race stays as the safety net. |
| 6 | **Cross-origin ops step** (one-time, CLI): a CORS policy on the `kwigbelle` bucket (GET, any origin) and a CloudFront CORS response-headers policy, so stage and local dev — different origins — can fetch the mirror. The absolute prod URL is the ONE mirror lane everywhere; stage stores no copy. | One copy, addressable from every environment; doubling 285GB into stage for symmetry would be pure cost. |
| 7 | **Trigger discipline**: the capture runs once, operator-invoked, resumable; `--verify N` re-downloads N random mirrored files and re-checks sha256 against the manifest. Re-runs skip completed tokens (progress file) so a crash or a new gap discovery costs nothing. | Same verification culture as fetch-burned/check-corpus. |
| 8 | Ships as two PRs: **PR A** — guardrail + capture tool + manifest schema (Decisions 1–4, 7, 9); the multi-day capture run happens after PR A merges, feeding the manifest; **PR B** — serving lane + CORS ops step (5–6), landing once the mirror is populated and verified. | The backup is the urgent half and must not wait on serving design; serving without a populated mirror would 404 every fetch. |
| 9 | **Operator-facing progress file** (operator request 2026-08-25): alongside the machine resume state, the tool maintains `feedback/VRM-MIRROR.md` (gitignored, PROGRESS.md convention) — a status block rewritten every few tokens: done/total counts, GB captured, current rate and ETA, the token in flight, and running retry/gap tallies — followed by an appended event log (gaps found, uploads retried, run started/resumed/stopped). Readable at any moment with `cat`, or watched live with `tail -f`. | A multi-day background run must be followable without chat scrollback or reading JSON resume state — same reasoning as the PROGRESS.md house rule. |
| 10 | **Public progress surface** (operator request 2026-08-26): each capture run publishes a tiny `_status.json` next to the mirror objects (merge-on-write, one slot per `--from/--until` front; `Cache-Control: no-cache`; best-effort — a failed publish never touches the capture). The site's "3D model" section gains a small ⓘ button opening a mirror-status modal: overall bar, models-backed-up count, GB, and a freshness line per front. Same-origin fetch of `vrm/_status.json` — the mirror lives in the bucket the site is served from, so the modal needs no CORS, no AWS API, and no backend. `_status.json` is not a `*.vrm` name, so it can never collide with a mirrored model. | The operator can watch the backup from the site itself; visitors see the preservation work happening. Zero-infrastructure by construction: the only writer is the capture tool that already holds bucket creds. |

## Proposed design surface

```
deploy.sh                 both sync commands: --exclude "vrm/*"
Tools/mirror-vrms.js      (new) capture: metadata -> pinata stream
                          -> verify -> sha256 -> s3 cp; resumable
                          progress file; --verify N audit mode;
                          gap ledger; parameterized destination;
                          live status -> feedback/VRM-MIRROR.md
Tools/data/vrm-manifest.json  committed integrity record (-diff)
Lib/VRMSource.js          fetchVRM: mirror-first lane (derived
                          filename), gateway race as fallback
Lib/MainScene.js          wires a kind lookup (hash corpus) into
                          VRMSource for filename derivation
```

## Steps

1. **PR A — guardrail + capture.** Action: Decisions 1–4, 7, 9.
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
- 2026-08-25 — Operator amendments during TAD review: a
  followable progress file (Decision 9 — feedback/VRM-MIRROR.md
  status block + event log, tail -f-able) and the in-repo
  question resolved in favor of committing the tool with a
  parameterized destination so others can replicate the backup
  (Decision 3).
- 2026-08-25 — Capture LIVE (operator-started). First-hours field
  notes: transient TLS drops on multipart uploads (tool retries
  recovered every token; bucket got an abort-incomplete-multipart
  lifecycle rule so orphaned parts don't bill), and a sequential
  rate of ~0.3 MB/s projecting ~13 days. Operator directive ("I
  don't want this to take a week"): the capture gained a worker
  pool (--parallel, default 3, max 4) - per-worker temp files,
  in-flight filename reservations, a pid lockfile so two runs
  can't interleave manifest saves, and selftest/verify moved to
  their own temp names after the live run clobbered the shared
  one mid-test. Parallelism hides gateway latency and backoff
  sleeps; it cannot exceed the uplink's bandwidth.
- 2026-08-25 — Parallel-capture amendment merged (PR #27,
  9f62607) after FIVE rounds of genuine lock hardening: atomic
  wx create, rename-steal reclaim, exclusive-create restore, and
  finally the structural guarantee - per-token AND per-write
  ownership gates on the manifest, so no lock race can interleave
  snapshots. Plus async uploads (a sync exec froze all sibling
  workers), scoped temp sweep, capture-counted --limit.
- 2026-08-25 — Gateway saga, in order: the laptop capture proved
  UPLINK-bound (~0.36 MB/s regardless of workers); moved to the
  operator's Lightsail instance (~3.2 MB/s, ETA ~28h); pinata
  then 429'd the instance even at --parallel 1 (datacenter IP
  ranges are throttled harder than residential). PR #28 (the
  implemented serving lane) was CLOSED and preserved at 0c103a3
  so a hotfix could take develop: PR #29 (merged 800dd73) adds a
  SHARED 429 cooldown (all workers pause together, Retry-After
  honored in both header forms, 300s clamp, bodies cancelled) and
  --gateway so the capture can run through a local kubo node's
  gateway (bitswap, no HTTP limits) or any alternative gateway -
  CORS-dead ones are fine server-side. First kubo probe 504'd on
  a cold DHT; provider existence and the alternative-gateway
  sweep are PENDING operator results, which pick the lane.
- 2026-08-26 — Kubo lane chosen, then throttled by STALLS. The
  operator's probes: providers exist on the DHT (two peers -
  pinata's infrastructure - serve the whole corpus; tokens are
  pinned in BATCH directories, e.g. one CID spans ~#223-346),
  and a warm fetch through the local kubo gateway pulled 9.25MB
  in 2.5s. The capture ran at ~2.25 MB/s, then the upstream
  peers began letting connections sit idle: transfers die by
  idle-timeout abort, not 429. The pattern is a transfer budget
  per window - rest restores flow (227 tokens overnight), then
  it chokes again at any parallelism. Manual stop/resume works
  but can't run unattended, so the tool gained STALL AUTO-REST:
  an idle-timeout abort is reported as "stalled" and feeds a
  shared ladder - three consecutive stalls rest ALL workers
  (5 min, doubling to a 60 min cap while the choke persists;
  any flowing bytes reset the ladder). Selftest grew a hanging
  fixture exercising the abort kind, the arming threshold, the
  escalation, and the reset.
- 2026-08-26 — Two-front capture + public progress. The gateway
  sweep from the instance settled the lane question for good:
  EVERY public gateway 504s upstream on this corpus (ipfs.io,
  dweb.link, 4everland, w3s.link; cf-ipfs dead) - pinata's two
  peers are the sole source on the entire IPFS network. The one
  untapped independent budget was the operator's residential IP
  against pinata's HTTP gateway (never throttled on day 1, just
  uplink-bound), so the tool gained --from/--until range bounds
  (each machine owns a slice, own manifest, clean finish, zero
  duplicated work) and --merge to fold the records into the
  final committed manifest, refusing on any disagreement. Both
  fronts launched 2026-08-26: instance = kubo lane, tokens
  0-13,999; laptop = pinata HTTP, tokens 14,000-26,616.
  Decision 10 (same day): capture publishes _status.json to the
  mirror prefix; the site's 3D-model section gained the ⓘ
  mirror-status modal reading it same-origin.
- 2026-08-27 — Per-token backup indicator (operator request): the
  3D model section's bottom row shows a green "Backed up" / red
  "Pending backup" dot for the DISPLAYED token - one same-origin
  HEAD of vrm/<filename> (filename derived locally via kindLabel,
  no metadata call), generation-guarded against superseding token
  loads. A pending token logs one benign console 404 per view;
  console-strict tests route the probe. Strings/meta entries added
  (coverage test enforced). Stamp 2026-08-27.2.
- 2026-08-27 — PR B RESTORED (operator "go", mirror at ~42%):
  the original gating reason (an empty mirror would 404 every
  fetch) expired - the fallback race covers misses, and the
  public gateway ecosystem is confirmed shutting down (ipfs.io /
  dweb.link EOL). Cherry-picked 0c103a3 onto develop: VRMSource
  mirror-first lane (scene-wired kind lookup; lane OFF unwired,
  pinned by the pre-existing suite), degraded vrmInfo, harness
  mirror routes. Reconciled with the six PRs merged since,
  including PR #38's backup indicator: the indicator now probes
  the SAME absolute mirror URL as the serving lane (truthful on
  stage/local dev once CORS lands - review catch), and a gap
  token's permanent "pending" is an accepted, documented
  limitation (client-side code cannot know gap-ness without the
  metadata call the indicator avoids). Merge gates: operator-run
  CORS ops + QA. Stamp 2026-08-27.3.
- 2026-08-31 — Known-missing surfaced in the status modal
  (operator request). The 2026-08-30 handoff
  (feedback/HANDOFF-vrm-mirror-2026-08-30.md) established two
  unmirrorable blocks, both verified against the live source:
  #23000–#23199 (200) are a stable 404 inside an otherwise-live
  Pinata pin (sibling #23466 under the same CID serves — raised
  with the original project, who may hold the source files), and
  #26530–#26616 (87) were minted months AFTER the collection's
  one VRM generation batch (mint-block cliff at the boundary; the
  tail batch directory's DAG ends at 26529) — no model ever
  existed. The modal now renders a "Known missing" section with
  both ranges and reasons (KNOWN_MISSING constant in
  VRMSection.js; copy in Strings.mirror; remove an entry if its
  block is ever restored and captured), and the note copy is
  revised from "preserves every one of them" to "every model that
  can still be fetched" — the achievable ceiling is 26,530.
- 2026-08-31 — `--skip A-B` flag (operator request). The endgame
  sweep for front B's last 39 fetchable stragglers starved behind
  the 23000-23199 dead block: each of the 200 burned 6 retry
  attempts per run, and the rapid-fire 404 grinding tripped
  Pinata's rate limiter (300s shared cooldowns - observed ~25
  minutes per token, ~20h projected before the sweep would reach
  the first straggler). `--skip` (inclusive, repeatable) makes the
  capture never attempt a block the source is KNOWN not to serve:
  skipped ids are neither failures nor gaps - just deferred, so a
  later run without the flag retries them if Pinata restores the
  block. Pending/ETA and the status line account for skips;
  selftest covers parsing and membership.
