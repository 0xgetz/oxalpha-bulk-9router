#!/bin/bash
# Ox Alpha bulk -> 9Router quick start.
#
#   ./run.sh create --count 5                 harvest 5 anonymous sessions
#   ./run.sh list                             show the pool
#   ./run.sh adapter                          run the OpenAI-compatible pool adapter
#   ./run.sh connect                          register it into 9Router
#
# A browser is required. Either attach to a remote one:
#     export CDP_URL=wss://<host>/devtools/browser/<id>
#   or point at a local Chromium:
#     export CHROME_PATH=/usr/bin/chromium
set -e
cd "$(dirname "$0")"
case "${1:-}" in
  create)  shift; node src/cli.js create "$@" ;;
  list)    node src/cli.js list ;;
  adapter) node src/cli.js adapter ;;
  connect) node src/cli.js connect ;;
  test)    shift; node src/cli.js test "$@" ;;
  *)       node src/cli.js ;;
esac
