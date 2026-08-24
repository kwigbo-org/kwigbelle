# kwigbelle

Home of kwigbelle — an interactive [Avastars](https://avastars.io)
display, built to rekindle interest in the collection. An Avastar
renders as independently-moving layers with spring physics, idle
breathing, and pointer-follow parallax. The side panel (⚙) lets you
load any of the 26,617 tokens by id, tune the motion, inspect every
trait with its rarity tier icon, and preview trait swaps — what a
replicant built from other Avastars' traits could look like
(display-only: the replicant factory is closed and the contract is
locked). Each token gets an identity card — Founder/Exclusive/
Prime/Replicant, series, 1-100 rarity score with its tier, trait
distribution, and (for Series 1-5 primes) frozen Unique-By combo
counts — in the avastars.io visual language. Every
Avastar also toggles into its assigned 3D model (VRM, fetched from
IPFS on demand). No wallet needed for any of it; the profile drawer
(the tab above ⚙) connects one to browse your own Avastars and
download the VRMs you own.

Static site, no build step. Layers are composed client-side from a
committed library of 614 per-trait SVG fragments extracted from the
on-chain renderer and validated byte-for-byte against it (see
`docs/tads/trait-composition.md` for the full design history).

## Develop / QA

```bash
./deploy.sh -w        # build to ~/Sites and serve at 127.0.0.1:8000
```

URL flags: `?tokenid=N` · `?explode=1`

Tests: see [Tests/README.md](Tests/README.md).
Lint/format: `npm install` once, then `npm run check` (local only).
Contributor/agent guide: [CLAUDE.md](CLAUDE.md).

## Deploy

```bash
./deploy.sh -s        # push to stage
./deploy.sh -p        # promote stage -> production
```
