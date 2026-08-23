# TAD: VRM 3D viewer (vector ↔ 3D toggle)

- **Status:** Steps 1-4 applied — in review (2026-08-22, PR #11)
- **Driver:** Operator: "there is a 3D model VRM that is assigned
  to each avastar... implement some kind of viewer for the VRM. So
  you could toggle a 3d button to switch between vector and 3d." +
  "We can't change traits on the VRMs though so in this mode the
  settings should be limited." + "If the user owns the avastar the
  settings should have a download button."

## Context

Every Avastar has an assigned `.vrm` model (a glTF binary with the
VRM extension). Discovery was live-verified on 2026-08-22:

- `https://avastars.io/metadata/{tokenId}` returns JSON whose
  `vrm_url` field points at the model on IPFS
  (`https://ipfs.io/ipfs/{CID}/Avastar_Prime_{tokenId}.vrm`). The
  endpoint echoes the requesting origin in
  `access-control-allow-origin`, so the browser can call it
  directly from the site.
- The IPFS file itself is served with `access-control-allow-origin:
  *`. Gateways differ in reliability: on the probe, `ipfs.io`
  returned HTTP 504 (cold content) while `gateway.pinata.cloud`
  served the same CID immediately (200, `content-length: 9255504`
  — ~9.3MB) and `dweb.link` 301-redirected to a subdomain form.
- The site is static with no build step (ES modules served as-is),
  so 3D libraries must be vendored, not bundled.

The vector display (composition, springs, trait preview) is
untouched by this feature; 3D is an alternate view of the SAME
loaded token, entered and left via a toggle.

## Decisions

1. **Vendor three.js + @pixiv/three-vrm as ES modules under
   `Lib/vendor/`, wired by an import map.** Pinned pair: `three`
   0.185.1 + `@pixiv/three-vrm` 3.5.5 (peer range `three>=0.137`).
   Exact file set, npm-package relative layout preserved so the
   files' own relative imports resolve unmodified:
   - `Lib/vendor/three/build/three.module.min.js` (imports
     `./three.core.min.js`)
   - `Lib/vendor/three/build/three.core.min.js`
   - `Lib/vendor/three/examples/jsm/loaders/GLTFLoader.js`
     (imports `three`, `../utils/BufferGeometryUtils.js`,
     `../utils/SkeletonUtils.js`)
   - `Lib/vendor/three/examples/jsm/utils/BufferGeometryUtils.js`
   - `Lib/vendor/three/examples/jsm/utils/SkeletonUtils.js`
   - `Lib/vendor/three/examples/jsm/controls/OrbitControls.js`
   - `Lib/vendor/three/LICENSE` (MIT)
   - `Lib/vendor/three-vrm/three-vrm.module.min.js` (imports only
     bare `three`)
   - `Lib/vendor/three-vrm/LICENSE` (MIT)

   `index.html` gains `<script type="importmap">` in `<head>`,
   mapping bare `"three"` to the vendored build. Placement is
   load-bearing: the HTML spec requires an import map to appear
   before ANY `<script type="module">` in document order (the
   site's module script is in `<body>`, so `<head>` satisfies
   this). Import maps are supported by every currently-supported
   evergreen browser (Safari 16.4+ is the baseline — later than
   ES-module support itself, but years shipped by now; no
   fallback is provided for older browsers).
   First-party code imports GLTFLoader/OrbitControls by relative
   path, so no `three/addons/` mapping is needed. ~1.1MB added;
   vendored files are never edited (existing rule), excluded from
   lint/format (existing ignore), and `/Lib/vendor/**` is marked
   `-diff` in `.gitattributes` (also covers the pre-existing
   `web3.min.js`, closing a known panel-crash hazard). Rationale:
   no build step is a repo constraint; import map is the standard
   no-bundler answer to bare-specifier imports.
2. **`Lib/VRMSource.js` owns the URL pipeline: metadata fetch →
   `vrm_url` → CID+path → gateway fallback list.** The `/ipfs/
   {CID}/{path}` suffix is parsed out of `vrm_url` and tried
   against, in order: `gateway.pinata.cloud`, `ipfs.io`,
   `dweb.link` (redirects are followed by fetch). Pinata goes
   first because the probe showed it serving content the canonical
   ipfs.io URL 504'd on, and a 504 only arrives after the
   gateway's own long timeout — putting the observed-reliable
   gateway first is the difference between ~2s and ~60s to first
   paint. A non-OK response or network error advances to the next
   gateway; all-fail surfaces an inline error. If `vrm_url` ever
   stops matching the `/ipfs/` shape, it is fetched as-given (no
   fallback) rather than rejected.
3. **Fetch on demand only, streamed with progress, small LRU
   cache.** ~9.3MB per model means nothing is fetched until the
   user taps 3D. The response body is read as a stream so progress
   can render (percent when `content-length` is present, MB count
   otherwise). Fetched bytes are cached in-memory per token (LRU,
   cap 3 ≈ 28MB); metadata JSON responses are cached per token
   without cap (tiny). The parsed three.js scene is NOT cached:
   only the current model is mounted, and it is disposed
   (`VRMUtils.deepDispose`) when replaced or when leaving 3D.
   Cross-session caching (Cache API) is a possible follow-up, out
   of scope here.
4. **`Lib/VRMViewer.js` owns the 3D display: its own canvas
   overlaying the main canvas, own render loop.** WebGLRenderer +
   scene + camera + hemisphere/directional lights + OrbitControls
   (rotate/zoom/pan), `VRMUtils.rotateVRM0` to normalize VRM 0.x
   facing, camera auto-framed from the model's bounding box,
   `vrm.update(dt)` each frame (drives spring-bone hair/cloth
   where models have them). The viewer runs its own rAF loop while
   mounted; the 2D `render()` early-returns while 3D is active.
   Because `layerSprings.step()` runs inside `render()`, that
   early return pauses BOTH the spring physics and the drawing —
   deliberate: nothing 2D is visible in 3D mode, and paused
   springs keep their state, so leaving 3D resumes them exactly
   where they were (same behavior as the existing "Pause motion"
   effect). The frame-time clamp already prevents a re-entry
   lurch, exactly as it does for a background tab. `hide()`
   stops the loop, unmounts the canvas, and disposes the model +
   renderer. A glTF that parses but carries no VRM extension is
   treated as a load failure, not silently shown.
5. **Toggle UI: a floating "3D" button (bottom-left, styled like
   the ⚙ handle) + the same action in a new "3D model" panel
   section.** The button reads "3D" in vector mode; while
   fetching it shows live progress and a tap aborts
   (AbortController) back to vector; in 3D mode it reads "2D" and
   returns to vector. WebGL support is feature-detected on first
   tap (not at startup — no GPU context spent on a feature that
   may never be used); unsupported → inline error, stay in
   vector. Failures anywhere in the pipeline (metadata, all
   gateways, parse) surface as a small inline error near the
   button and leave the vector view untouched.
6. **Limited settings in 3D mode (operator constraint — traits
   cannot change on a VRM):**
   - Effects section: hidden entirely (spring rig doesn't apply).
   - Traits section: read-only — trait cards stay as information,
     but visibility checkboxes, Edit buttons, was/undo rows, and
     Reset-all are hidden. Preview overrides are PRESERVED in
     scene state (not cleared) and simply don't apply to 3D; a
     note in the section says the 3D model always shows the
     original on-chain Avastar. Returning to vector restores the
     overridden preview exactly.
   - Load section: stays available. Loading any token EXITS 3D
     mode back to vector (the load flow is vector-native; the
     user opts into 3D per token — no surprise 9MB downloads).
     `beginLoad` is the single choke point, so this covers every
     load path — the Load section, a picker pick, and the silent
     wallet auto-swap alike.
   - `SidePanel.addSection` returns the section element so the
     scene can show/hide sections by mode.
7. **"3D model" panel section content:** a short note (what the
   VRM is), a "View in 3D / Back to vector" button mirroring the
   floating toggle, and — only when the connected wallet owns the
   displayed token — a "Download VRM" button (operator
   directive). Download reuses the same fetch pipeline and cache,
   saves under the model's original filename from `vrm_url`
   (object URL + anchor download, revoked after click). Ownership
   = displayed token ∈ the owned-token list the scene already
   receives when the picker builds (recorded on the scene as a
   Set; updated on connect and on the silent initial enumeration;
   walletless visitors never see the button).
8. **Race guards, same discipline as the existing machinery:** a
   `vrmGeneration` counter is bumped by every 3D-toggle
   transition AND by `beginLoad` (which also exits 3D mode
   synchronously). A stale fetch/parse completion — token loaded
   mid-fetch, toggle spammed, abort fired — checks its captured
   generation before mounting anything. Single-flight: while a
   fetch is active the toggle's only action is abort. The
   download button runs the same pipeline but mounts nothing, so
   it needs no generation check beyond its own abort on section
   teardown.
9. **3D works for static-fallback displays too.** The VRM
   pipeline depends only on the token id (metadata endpoint), not
   on composition, so a token showing the degraded single-layer
   fallback can still toggle to 3D.
10. **Tests mock the network at the harness layer; the model
    fixture is a gitignored auto-downloaded cache.** Playwright
    route interception serves `avastars.io/metadata/*` from a
    local JSON fixture and the gateway URLs from a local `.vrm`
    file; one scenario 504s the first gateway to prove fallback.
    The real 8014 VRM (~9.3MB) is downloaded once into
    `Tests/fixtures/` on first run and reused after.
    `/Tests/fixtures/` is NOT in `.gitignore` today — adding it
    is an explicit Step 2 action (same precedent as the already-
    ignored `Tools/data/renders/` corpus cache), or the first
    test run would stage a 9MB binary. If that first-run
    download fails the test FAILS with a
    message naming the network cause — no silent skip. Headless
    Chrome renders WebGL via SwiftShader; the harness asserts a
    non-blank 3D canvas.
11. **Out of scope:** animation clips/expressions/poses beyond
    built-in spring-bones; AR; cross-session model caching;
    avastars.io design-cue restyling (separate TAD); any change
    to the vector render path.

## Proposed design surface

```
index.html
  <script type="importmap"> { "imports": { "three":
    "./Lib/vendor/three/build/three.module.min.js" } }

Lib/VRMSource.js
  new VRMSource()
  async vrmInfo(tokenId) -> { url, filename }        (metadata, cached)
  async fetchVRM(tokenId, onProgress(loaded, total), signal)
    -> ArrayBuffer                                    (gateways + LRU)

Lib/VRMViewer.js
  new VRMViewer(rootContainer)
  async show(arrayBuffer) -> void    parse + mount + start loop (throws)
  hide()                             stop + unmount + dispose

Lib/ViewToggleUI.js
  new ViewToggleUI(rootContainer, onToggle)
  setMode("vector" | "loading" | "3d"), setProgress(loaded, total)
  showError(message)

Lib/VRMSection.js
  new VRMSection(onToggle, onDownload)               body via build()
  setMode(mode) / setOwned(isOwned) / setProgress(...)

SidePanel
  addSection(title, contentElement) -> section element (was void)

TraitsSection (extended)
  setReadOnly(isReadOnly)    hides visibility/edit/undo/reset, shows note

MainScene (extended)
  is3D, vrmGeneration, ownedTokenIds: Set
  toggle3D() / enter3D() / exit3D()
  beginLoad: also exits 3D + bumps vrmGeneration
```

## Steps

1. **Vendor + import map.**
   Action: add the Decision-1 file set verbatim from the npm
   tarballs, the import map to index.html, `/Lib/vendor/** -diff`
   to .gitattributes.
   Validate: full suite green (no behavior change yet);
   `npm run check` clean; smoke-load the site and
   `import("three")` resolves in the console.
   Rollback: delete the vendor dirs + the importmap block; no
   first-party code references them yet.
2. **VRMSource (metadata → gateways → cache → progress).**
   Action: new module per the design surface; add
   `/Tests/fixtures/` to `.gitignore` before the first harness
   run (Decision 10).
   Validate: new harness test with routed fixtures — happy path
   returns bytes with progress callbacks; first-gateway 504 falls
   through to the second; all-fail rejects; metadata + bytes are
   served from cache on the second call (route hit-count).
   Rollback: additive module, revert commit.
3. **VRMViewer + toggle + scene wiring.**
   Action: viewer, floating toggle, enter3D/exit3D with
   vrmGeneration guards, beginLoad exits 3D.
   Validate: harness — toggle shows progress then a non-blank
   #vrmCanvas; toggling back restores the vector canvas and
   springs; loading a token while in 3D (and while fetching)
   lands in vector on the new token with no stale mount; abort
   via mid-fetch tap. Manual QA on live data at 127.0.0.1:8000.
   Rollback: remove toggle registration + modules; scene diff is
   confined to the new methods + beginLoad's two added lines.
4. **Limited settings + "3D model" section + owned download.**
   Action: section per Decision 7, TraitsSection.setReadOnly,
   Effects hidden in 3D, ownedTokenIds recorded, download flow.
   Validate: harness — in 3D the Effects section is hidden,
   trait checkboxes/edit are gone and the read-only note shows,
   overrides survive a 3D round-trip (byte-identical frozen
   frame); download button absent walletless, present via the
   wallet mock owning the token, and the anchor download carries
   the original filename; back in vector everything reappears.
   Rollback: UI-only commit revert.

Each step lands as a follow-up commit to this PR (pattern (a));
build stamp bumps with the first user-visible step.

## Client review status

Single-lane feature; no cross-lane consumers.

- [x] (none — kwigbelle-internal; operator is the only consumer)

## Downstream commitments

None owed to other lanes. Possible follow-ups tracked in memory:
Cache-API cross-session model cache; avastars.io design-cue TAD
may restyle the toggle/section it introduces.

## Progress log

- 2026-08-22 — Draft written from operator directives (toggle +
  limited 3D settings + owner download) and the live-verified
  discovery notes; opened for panel review before implementation
  (pattern (a)).
- 2026-08-22 — Panel round 1 (lite, docs-only scope):
  STATUS:FINDINGS (0/3). All prose-accuracy, all fixed: (a) the
  render() early-return pauses spring physics along with drawing
  (step runs inside render()) — Decision 4 now says so and calls
  the freeze deliberate; (b) `Tests/fixtures/` claimed gitignored
  but isn't — now an explicit Step 2 action; (c) import-map
  placement constraint (must precede any module script → head)
  made explicit; (d) import-map browser-support claim softened to
  the real baseline (Safari 16.4+); (e) noted beginLoad is the
  single choke point, so picker picks and the silent wallet swap
  exit 3D too, not just the Load section.
- 2026-08-22 — Panel round 2: STATUS:CLEAN (3/3). Beginning
  implementation as follow-up commits.
- 2026-08-22 — Step 1 applied: vendored file set verbatim from the
  npm tarballs, import map in head, /Lib/vendor/** -diff.
  Validated: suite 10/10 unchanged; in-page probe resolves three
  r185 + VRM/VRMLoaderPlugin/VRMUtils/GLTFLoader/OrbitControls.
- 2026-08-22 — Step 2 applied: Lib/VRMSource.js; /Tests/fixtures/
  gitignored. Validated by Tests/vrm-source-test.js (routed
  fixtures): progress streams to completion with byte integrity,
  cache prevents refetch, 504 advances gateways in the decided
  order, all-fail rejects with the HTTP error, abort rethrows
  without advancing.
- 2026-08-22 — Step 3 applied: Lib/VRMViewer.js + ViewToggleUI +
  scene wiring (vrmGeneration; beginLoad exits 3D synchronously);
  stamp 2026-08-22.8. Validated by Tests/vrm-viewer-test.js with
  the real 8014 model as an auto-downloaded fixture: headless
  WebGL renders non-blank (8.2% painted share), cached re-entry
  makes no second fetch, a mid-fetch tap cancels, a token load
  mid-fetch discards the stale mount.
- 2026-08-22 — Step 4 applied: VRMSection ("3D model": note +
  toggle twin + owner-gated Download VRM), TraitsSection read-only
  mode (baseline cards, no controls, honesty note), Effects hidden
  in 3D, ownership recorded from both enumeration paths. Validated
  by Tests/vrm-panel-test.js: limits assert clean, an override
  survives the 3D round-trip with byte-identical pixels, the
  download event carries the original filename, an unowned token
  hides the button. One deviation from the draft surface: the
  toggle callback pair collapsed into MainScene.setVRMMode keeping
  button and section in step (no separate setProgress plumbing on
  ViewToggleUI beyond the shared progressText helper).
- 2026-08-23 — Post-merge amendment (operator: intermittent VRM
  loading failures). Field measurements falsified Decision 2's
  sequential-fallback premise: EVERY public gateway intermittently
  hangs 20s+ on some CID (pinata included), and dweb.link
  hard-fails on Qm CIDs (its path->subdomain redirect breaks on
  base58 case) - which is every founder and replicant model. One
  hung gateway therefore stalled the whole sequential chain with
  no timeout. Decision 2's ORDER stands but the strategy is now a
  hedged race (VRMSource.hedgedDownload): attempts start 4s apart
  (immediately on a fast failure), first body chunk wins and
  aborts the rest, and each attempt has a 20s first-byte cap.
  Verified by the new hung-gateway scenario in vrm-source-test
  (stalled pinata rescued by ipfs.io in ~0.4s at test stagger).
  Additionally, candidate URLs rewrite CIDv0 (Qm...) to CIDv1
  base32 (in-repo cidV0toV1, ~50 lines, no dependency): the
  mixed-case Qm form is what breaks the subdomain redirects, and
  every founder/replicant model is published under one.
  Conversion correctness proven live (pinata serves the converted
  pair byte-range-identically) and pinned in the harness against
  the verified pair. Live browser check: replicant 25500 - which
  previously depended on a single viable lane - loads in ~7s with
  two lanes failing and the race absorbing them.
- 2026-08-22 — Operator QA: the button-only loading indicator was
  too subtle. Added a center-screen overlay (site spinner + phase
  line + progress bar + cancel hint): indeterminate sweep until the
  first sized progress event, live percent after, distinct
  "Preparing model…" parse phase. Operator QA +1.
- 2026-08-22 — Panel round 3 on the implementation: 2/4 (opus-4-7
  and Codex CLEAN). Both LOWs fixed as fix-pushes: (a) the abort
  signal now covers the metadata fetch too, not just the byte
  download (vrm-source-test asserts no endpoint sees a request from
  a pre-aborted call); (b) hide() calls forceContextLoss() before
  renderer.dispose() so rapid toggling can't accumulate live GL
  contexts.
