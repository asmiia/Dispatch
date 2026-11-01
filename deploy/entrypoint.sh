#!/bin/sh
# Generates a persistent one-time setup key on first run if none is provided.
set -e
if [ -z "$DISPATCH_SETUP_KEY" ]; then
  keyfile="$DISPATCH_DATA_DIR/.setup-key"
  if [ ! -s "$keyfile" ]; then
    umask 077
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$keyfile"
  fi
  DISPATCH_SETUP_KEY=$(cat "$keyfile")
  export DISPATCH_SETUP_KEY
  echo "Dispatch: setup key stored in $keyfile (docker compose exec dispatch cat $keyfile)"
fi
exec "$@"
