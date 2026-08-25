# Headless harness tests

Browser-level tests driving the real site in headless Chrome with
mocked wallet providers. These are the tests every PR in this repo has
been verified against; they are NOT deployed (deploy.sh doesn't copy
`Tests/`).

## Setup (once)

Requires Node 20+ and Google Chrome installed (`playwright-core` uses
the installed Chrome via `channel: "chrome"` — no browser download).

```bash
cd Tests && npm install
```

## Running

Serve the repo root, then run any test from `Tests/`:

```bash
# terminal 1, from the repo root:
python3 -m http.server 8741

# terminal 2:
cd Tests
node smoke.js          # no-wallet load, spring motion, follow/release
node compose-test.js   # trait composition: parity, layer names, forced-failure static fallback
node picker-test.js    # profile drawer: grid, badge, composed thumbnails (0 RPC), pick, logout
node chooser-test.js   # multi-wallet chooser + localStorage persistence across reload
node switch-test.js    # wrong-network -> Switch to Mainnet button -> reload -> grid
node eip-test.js       # EIP-6963 discovery, legacy fallback, tap-to-connect
node failure-test.js   # happy mainnet / wrong chain / failing RPC render
node panel-test.js     # side panel: open, pause/resume, trait visibility, persistence
node load-test.js      # Load Avastar section: walletless load, validation, composer split
node lab-test.js       # trait swap preview: modal, override, undo, reset, swap-clears
node vrm-source-test.js  # VRM fetch pipeline: gateways, progress, cache, abort (routed fixtures)
node vrm-viewer-test.js  # 3D entry/exit: WebGL render, cache re-entry, overlay cancel, load-supersedes
node vrm-panel-test.js   # 3D-mode settings limits + owner-only Download VRM
node identity-test.js    # identity card: chips, score bands, distribution, Unique-By, mint/burned
node effects-test.js     # poke, wave, trails, tilt follow + toggle persistence
```

Every test prints its own pass evidence and exits nonzero on any
failed check (look for `FAIL:` lines on stderr);
screenshots land in the `Tests/` working directory (gitignored noise —
delete freely).

## How the mocks work

Tests inject fake wallet providers via `page.addInitScript` before the
page loads: EIP-1193 `request()` handlers answer `eth_accounts`,
`eth_chainId`, `wallet_switchEthereumChain`, and `eth_call` — the
`eth_call` mock decodes function selectors using the page's own
bundled web3 and serves render SVGs from the local `SVG/` files.
EIP-6963 wallets are announced with `eip6963:announceProvider` events.
State that must survive a reload (network switches, authorization)
lives in `sessionStorage` inside the mock.

The VRM tests route `avastars.io/metadata/*` and every IPFS gateway
to local fixtures. The model fixture itself (the real 8014 `.vrm`,
~9.3MB) is auto-downloaded ONCE into `Tests/fixtures/` (gitignored)
by `vrm-viewer-test.js` and reused after — that first run is the one
place the harness needs network.

No other test touches the real network; `AVASTARS_RPC_URL` is not needed.
(The on-chain integration surface is covered separately by
`Tools/validate-composition.js`, which does need the RPC env var.)
