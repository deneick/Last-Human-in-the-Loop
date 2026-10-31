#!/usr/bin/env bash
# Experimente zum Regelsatz v3 (reproduzierbar, fortsetzbar: fertige Modelle werden übersprungen).
# 3 PPO-Seeds mit GRU-Gedächtnis, 3 PPO-Seeds ohne Gedächtnis (gleiche Seeds), je 300 Updates.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p models/runs
run() {
  local id=$1; shift
  if [ -f "models/$id.json" ]; then echo "überspringe $id"; return; fi
  npx tsx scripts/train.ts --algo ppo --updates 300 --ruleset v3 --id "$id" "$@" > "models/runs/$id.log" 2>&1
}
for s in 21 22 23; do
  run "exp-v3-gru-s$s" --seed "$s" --notes "Regelsatz v3, GRU-Gedächtnis" &
  run "exp-v3-ff-s$s" --seed "$s" --memory false --notes "Regelsatz v3, ohne Gedächtnis (Kontrollversuch)" &
done
wait
