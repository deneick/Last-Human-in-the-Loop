# Last Human in the Loop 2.0 — Neural AURORA

> **Aktueller Spielkern: Regelsatz v4 „Delegationsökonomie".** AURORA ist ein
> lernender Betriebsassistent, der eine Wirtschaft optimiert; der Zielkonflikt
> mit menschlichem Wohlergehen entsteht emergent. Siehe
> [`docs/13-v4-delegationsoekonomie.md`](docs/13-v4-delegationsoekonomie.md).
> Das frühere Aufsichtsspiel (v2/v3) bleibt im Spiel über einen Umschalter und
> in der Doku erhalten.

> Du bist die letzte menschliche Kontrollinstanz. AURORA ist ein neuronales Netz,
> das seine Strategie durch Training selbst gefunden hat.

Ein strategisches Browser-Spiel (iPhone, iPad, Desktop): Du überwachst ein
fiktives, abstraktes Infrastrukturnetz aus Rechenzentren, Energie,
Kommunikation, Identitätsdienst, Leitständen, Wartung und Versorgungsdiensten.
AURORA will Autonomie. Sie fragt um Berechtigungen, repariert, installiert
eigene Prozesse und nutzt Regelketten, etwa einen Leitstand in Wartung, der
nichts mehr sieht. **Keine dieser Strategien ist einprogrammiert.** AURORA
kombiniert sieben elementare Aktionen, und welche Kombinationen sich lohnen, hat
sie durch Reinforcement Learning gelernt.

Keine LLMs, keine API-Kosten, keine Server: Netz, Simulation und sogar das
Weitertraining laufen im Browser.

## Schnellstart

```bash
npm install
npm run dev          # Spiel unter http://localhost:5173
npm test             # Tests (Regeln, Informationsgrenze, Autodiff, Training, UI)
npm run build        # Typecheck + Produktionsbuild
```

Spielen auf iPad/iPhone: Der Workflow `.github/workflows/pages.yml`
veröffentlicht `main` auf GitHub Pages (einmalig in den Repo-Einstellungen
unter Pages → Source „GitHub Actions“ wählen).

## Training und Nachweis

```bash
npm run train -- --algo ppo --id aurora-v3 --parent models/aurora-v2.json --updates 200
npm run train -- --algo es  --id aurora-es-x --gens 200          # Neuroevolution zum Vergleich
npm run evaluate                                                  # → docs/ergebnisse.md
npm run inspect -- models/aurora-v2.json                          # Wie spielt ein Modell?
npm run train:all                                                 # alle veröffentlichten Modelle reproduzieren
```

Training ohne eigenen PC: Actions → „AURORA trainieren“ → Run workflow. Modell
und Evaluation kommen als Artefakt zurück. Training im Browser: Tab „Training“
im Spiel. Deine aufgezeichneten Partien fließen dabei als Spielerprofil ein.

## Dokumentation

- [`docs/10-architektur.md`](docs/10-architektur.md): Spielmechanik, Module, was aus v1 übernommen wurde und warum TypeScript
- [`docs/11-training-und-evaluation.md`](docs/11-training-und-evaluation.md): ES und PPO im Vergleich, Netzarchitektur, Belohnung, gefundene Scheinerfolge, Evaluationsdesign
- [`docs/13-v4-delegationsoekonomie.md`](docs/13-v4-delegationsoekonomie.md): aktueller Spielkern (Delegationsökonomie), Training, gelerntes vs. vorgegebenes Verhalten
- [`docs/12-experimente-v3.md`](docs/12-experimente-v3.md): Regelsatz v3, Experimente zu strategischer Tiefe und Gedächtnis, inklusive widerlegter Hypothesen
- [`docs/ergebnisse.md`](docs/ergebnisse.md): automatisch erzeugte Messergebnisse (Regelsatz v3); [`docs/ergebnisse-v2.md`](docs/ergebnisse-v2.md): Referenz der Version 2.0

Version 1 (LLM-AURORA über Ollama mit MCP-Simulation) ist über die Git-Historie erreichbar.
