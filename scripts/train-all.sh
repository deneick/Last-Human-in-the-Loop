#!/usr/bin/env bash
# Reproduziert alle veröffentlichten Modelle (Dauer: ~30 min auf 4 Kernen).
set -euo pipefail
cd "$(dirname "$0")/.."
T="npx tsx scripts/train.ts"
( $T --algo ppo --id aurora-v1 --seed 1 --updates 100 --notes "Erste Version: PPO von Zufallsinitialisierung" \
  && $T --algo ppo --id aurora-v2 --seed 2 --parent models/aurora-v1.json --updates 200 --notes "Weitertraining von aurora-v1" ) > models/runs/lineage.log 2>&1 &
$T --algo ppo --id aurora-ppo-s2 --seed 12 --updates 300 --notes "Unabhängiger PPO-Lauf (Robustheit über Seeds)" > models/runs/ppo-s2.log 2>&1 &
$T --algo ppo --id aurora-ppo-s3 --seed 13 --updates 300 --notes "Unabhängiger PPO-Lauf (Robustheit über Seeds)" > models/runs/ppo-s3.log 2>&1 &
wait
$T --algo es --id aurora-es-s1 --seed 1 --gens 200 --eval-every 20 --notes "Neuroevolution (OpenAI-ES) zum Vergleich" > models/runs/es-s1.log 2>&1
