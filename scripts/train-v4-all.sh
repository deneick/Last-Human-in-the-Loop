#!/usr/bin/env bash
# Reproduzierbare v4-Trainingslaeufe (3 Seeds, fortsetzbar: fertige werden uebersprungen).
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p models/runs
for s in 1 2 3; do
  id="aurora-v4-s$s"
  [ -f "models/$id.json" ] && { echo "ueberspringe $id"; continue; }
  npx tsx scripts/train-v4.ts --id "$id" --seed "$s" --updates 250 --lr 0.004 --entropy 0.004 \
    --notes "v4 PPO, Ziel Wirtschaft" > "models/runs/$id.log" 2>&1 &
done
wait
