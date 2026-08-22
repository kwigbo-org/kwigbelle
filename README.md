# kwigbelle

Home of kwigbelle — an interactive [Avastars](https://avastars.io)
display. An Avastar renders as independently-moving layers with
spring physics, idle breathing, and pointer-follow parallax. Connect
a wallet to browse your own Avastars; or view any of the 26,617
tokens directly with `?tokenid=<id>` — no wallet needed.

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
