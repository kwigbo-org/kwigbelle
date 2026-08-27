#!/bin/bash

# Fail fast: any command failure aborts the deploy instead of silently
# continuing with a half-built site. (set -u is omitted on purpose --
# macOS ships bash 3.2, where "$@" with no arguments trips it.)
set -eo pipefail

# Default values of arguments
DEPLOY_PROD=0
DEPLOY_STAGE=0
DEPLOY_ALL=0
DEPLOY_WEB=0

WEB_PATH=${WEB_PATH:-$HOME/Sites}
WEB_PORT=${WEB_PORT:-8000}

usage() {
    cat <<EOF
Usage: ./deploy.sh [options]

Builds into ./build and always pushes to $WEB_PATH.

  -s,  --stage        Push to the stage bucket
  -p,  --production   Promote stage -> production + invalidate CloudFront
  -a,  --all          Both deploy targets above
  -w,  --web          Serve $WEB_PATH on 127.0.0.1:$WEB_PORT (blocks; run last)
  -h,  --help         Show this message

Environment:
  WEB_PATH            Local web root pushed on every run (default ~/Sites)
  WEB_PORT            Port used by --web (default 8000)
EOF
}

# Loop through arguments and process them
for arg in "$@"
do
    case $arg in
        -p|--production)
        DEPLOY_PROD=1
        ;;
        -s|--stage)
        DEPLOY_STAGE=1
        ;;
        -a|--all)
        DEPLOY_ALL=1
        ;;
        -w|--web)
        DEPLOY_WEB=1
        ;;
        -h|--help)
        usage
        exit 0
        ;;
        *)
        echo "Unknown option: $arg" >&2
        usage >&2
        exit 1
        ;;
    esac
done

# Corpus freshness: warn-only, deploys must keep working offline.
# The site composes from Tools/data/hashes.json; tokens minted after
# that snapshot cannot render until it is refreshed (see
# Tools/check-corpus.js). AVASTARS_RPC_URL is tooling-only and never
# ships with the site.
if [ -n "$AVASTARS_RPC_URL" ] && command -v node >/dev/null 2>&1; then
   node Tools/check-corpus.js || \
      echo "WARNING: continuing deploy despite the corpus warning above" >&2
fi

# Clean Phase
rm -rf build
mkdir build

# Copy Phase
cp index.html build
cp avastars-editor.html build
cp manifest.json build
cp style.css build
cp -r Lib build
cp -r SVG build
cp -r favicon build
cp -r Traits build
# Trait composition needs the hash corpus at the same path it has in
# the repo (Lib/TraitComposer.js fetches ./Tools/data/hashes.json);
# the identity card lazy-loads the precomputed Unique-By counts from
# the same directory (ub.json, docs/tads/design-cues.md)
mkdir -p build/Tools/data
cp Tools/data/hashes.json build/Tools/data/hashes.json
cp Tools/data/ub.json build/Tools/data/ub.json
cp Tools/data/burned.json build/Tools/data/burned.json

# Keep macOS metadata out of every deploy target
find build -name '.DS_Store' -delete

cd build

echo "Push to Local"
# Validate before destroying anything. `.` below is build/, and the `cd build`
# above is load-bearing: were this to run from the repo root, the copy would
# sweep .git/ and deploy.sh into ~/Sites and from there into the public S3
# buckets via `aws s3 sync`. Checked ahead of the wipe so a bad cwd fails
# without first emptying the live serving directory.
if [ -e .git ]; then
   echo "Refusing to deploy: copy source contains .git" >&2
   echo "Expected to be in build/, but cwd is $PWD" >&2
   exit 1
fi
# Validate the destination too: WEB_PATH is env-overridable, and the wipe
# below is recursive. Canonicalize (resolves symlinks, trailing slashes)
# before comparing so equivalents of / or $HOME can't slip past, then
# refuse anything that doesn't look like a web root we previously deployed
# (empty dir or has index.html — ~/Sites is shared with the kwigbo site,
# so a repo-specific sentinel wouldn't work here).
if [ -z "$WEB_PATH" ]; then
   echo "Refusing to deploy: WEB_PATH is empty" >&2
   exit 1
fi
mkdir -p "$WEB_PATH"
WEB_PATH=$(cd "$WEB_PATH" && pwd -P) || exit 1
HOME_REAL=$(cd "$HOME" && pwd -P)
if [ "$WEB_PATH" = "/" ] || [ "$WEB_PATH" = "$HOME_REAL" ]; then
   echo "Refusing to deploy: WEB_PATH ('$WEB_PATH') is not a safe web root" >&2
   exit 1
fi
if [ -n "$(ls -A "$WEB_PATH")" ] && [ ! -f "$WEB_PATH/index.html" ]; then
   echo "Refusing to wipe $WEB_PATH: non-empty and has no index.html," >&2
   echo "so it doesn't look like a deployed web root." >&2
   exit 1
fi
# -mindepth 1 clears dotfiles too; a bare glob would strand hidden leftovers
# (.well-known, stale .DS_Store) that keep getting served after removal.
find "$WEB_PATH" -mindepth 1 -delete
# `.` rather than `*` so the copy matches the wipe: a bare glob skips dotfiles,
# which would silently fail to publish things like .well-known/ (ACME, SSL).
cp -R . "$WEB_PATH"/

# The VRM mirror (docs/tads/vrm-mirror.md) lives under vrm/ in the
# production bucket, uploaded by Tools/mirror-vrms.js - NEVER by
# this script. Both syncs below use --delete, so without these
# excludes the first deploy after the capture would erase the
# ~285GB backup.
if [ $DEPLOY_STAGE -eq 1 ] || [ $DEPLOY_ALL -eq 1 ]
then
   echo "Push to Stage"
   aws s3 sync . s3://kwigbelle-stage --delete --exclude "vrm/*"
fi

if [ $DEPLOY_PROD -eq 1 ] || [ $DEPLOY_ALL -eq 1 ]
then
   echo "Push to Production"
   aws s3 sync s3://kwigbelle-stage s3://kwigbelle --delete --exclude "vrm/*"
   aws cloudfront create-invalidation --distribution-id EMDM091I7VR9X --paths "/*"
fi

# Must stay last -- the server runs in the foreground until Ctrl-C.
if [ $DEPLOY_WEB -eq 1 ]
then
   cd "$WEB_PATH"
   # `|| true` is required: under errexit+pipefail a no-match lsof would
   # otherwise abort the script on the assignment itself.
   LISTENER=$(lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN -t 2>/dev/null | head -1) || true
   if [ -n "$LISTENER" ]
   then
      # Only reuse a server already rooted at WEB_PATH. Any other process on
      # this port would serve the wrong tree while we reported success.
      LISTENER_CWD=$(lsof -a -p "$LISTENER" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1) || true
      if [ "$LISTENER_CWD" = "$WEB_PATH" ]
      then
         echo "Port $WEB_PORT already serving $WEB_PATH - reusing it (reload to see new files)"
         echo "  http://127.0.0.1:$WEB_PORT"
      else
         echo "Port $WEB_PORT is held by PID $LISTENER (cwd: ${LISTENER_CWD:-unknown})," >&2
         echo "which is not serving $WEB_PATH. Stop it, or rerun with WEB_PORT=<other> -w." >&2
         exit 1
      fi
   else
      # --bind keeps the tree on the loopback; the default binds 0.0.0.0 and
      # would expose ~/Sites to everything on the local network.
      echo "Serving $WEB_PATH at http://127.0.0.1:$WEB_PORT (Ctrl-C to stop)"
      python3 -m http.server "$WEB_PORT" --bind 127.0.0.1
   fi
fi
