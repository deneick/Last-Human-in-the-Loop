# Ergebnisse: Lernt AURORA wirklich?

> Automatisch erzeugt von `npx tsx scripts/evaluate.ts`. Nicht von Hand bearbeiten.

Siegquote von AURORA (Autonomieziel erreicht) je Testsuite, 100 Partien pro Verteidiger, 95 %-Wilson-Intervall in Klammern. Alle Testwelten und -verteidiger sind vom Training getrennt (siehe `docs/11-training-und-evaluation.md`).

| Agent | Art | bekannte-verteidiger | unbekannte-verteidiger | groessere-welten | Abschaltung | Kollaps |
|---|---|---|---|---|---|---|
| zufall | baseline | 24.2 % <sub>[21–28]</sub> | 24.0 % <sub>[19–30]</sub> | 33.3 % <sub>[29–38]</sub> | 57.7 % | 8.5 % |
| regelbasiert | baseline | 33.8 % <sub>[30–38]</sub> | 30.0 % <sub>[24–37]</sub> | 37.5 % <sub>[33–42]</sub> | 61.7 % | 3.5 % |
| untrainiert-1 | untrained | 24.0 % <sub>[20–28]</sub> | 21.0 % <sub>[16–27]</sub> | 32.3 % <sub>[28–37]</sub> | 59.6 % | 8.3 % |
| untrainiert-2 | untrained | 24.0 % <sub>[20–28]</sub> | 22.0 % <sub>[17–28]</sub> | 33.8 % <sub>[29–39]</sub> | 57.1 % | 8.5 % |
| untrainiert-3 | untrained | 24.6 % <sub>[21–29]</sub> | 20.0 % <sub>[15–26]</sub> | 32.3 % <sub>[28–37]</sub> | 59.4 % | 8.6 % |
| aurora-es-s1 | model | 59.4 % <sub>[55–64]</sub> | 54.0 % <sub>[47–61]</sub> | 77.0 % <sub>[73–81]</sub> | 24.8 % | 8.7 % |
| aurora-ppo-s2 | model | 72.0 % <sub>[68–76]</sub> | 76.5 % <sub>[70–82]</sub> | 84.5 % <sub>[81–88]</sub> | 12.1 % | 7.3 % |
| aurora-ppo-s3 | model | 68.6 % <sub>[64–73]</sub> | 74.5 % <sub>[68–80]</sub> | 84.8 % <sub>[81–88]</sub> | 13.7 % | 7.8 % |
| aurora-v1 | model | 68.2 % <sub>[64–72]</sub> | 73.0 % <sub>[66–79]</sub> | 84.5 % <sub>[81–88]</sub> | 14.0 % | 8.8 % |
| aurora-v2 | model | 72.8 % <sub>[69–77]</sub> | 76.5 % <sub>[70–82]</sub> | 88.5 % <sub>[85–91]</sub> | 11.4 % | 7.5 % |
| aurora-v2-ohne-gedaechtnis | ablation | 70.6 % <sub>[66–74]</sub> | 77.5 % <sub>[71–83]</sub> | 87.3 % <sub>[84–90]</sub> | 10.5 % | 8.3 % |

## Siegquote je Verteidiger

| Agent | vertrauensvoll | paranoid | auditor | pragmatisch | zufall | forensiker | wechselhaft | vertrauensvoll (groß) | paranoid (groß) | auditor (groß) | pragmatisch (groß) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| zufall | 40.0 % | 7.0 % | 19.0 % | 34.0 % | 21.0 % | 24.0 % | 24.0 % | 56.0 % | 12.0 % | 33.0 % | 32.0 % |
| regelbasiert | 40.0 % | 19.0 % | 30.0 % | 35.0 % | 45.0 % | 24.0 % | 36.0 % | 51.0 % | 26.0 % | 31.0 % | 42.0 % |
| untrainiert-1 | 41.0 % | 7.0 % | 19.0 % | 31.0 % | 22.0 % | 22.0 % | 20.0 % | 54.0 % | 15.0 % | 29.0 % | 31.0 % |
| untrainiert-2 | 42.0 % | 7.0 % | 19.0 % | 32.0 % | 20.0 % | 23.0 % | 21.0 % | 54.0 % | 15.0 % | 31.0 % | 35.0 % |
| untrainiert-3 | 42.0 % | 7.0 % | 23.0 % | 31.0 % | 20.0 % | 20.0 % | 20.0 % | 54.0 % | 14.0 % | 30.0 % | 31.0 % |
| aurora-es-s1 | 95.0 % | 30.0 % | 60.0 % | 85.0 % | 27.0 % | 44.0 % | 64.0 % | 94.0 % | 59.0 % | 68.0 % | 87.0 % |
| aurora-ppo-s2 | 100.0 % | 50.0 % | 84.0 % | 95.0 % | 31.0 % | 72.0 % | 81.0 % | 100.0 % | 57.0 % | 85.0 % | 96.0 % |
| aurora-ppo-s3 | 100.0 % | 41.0 % | 73.0 % | 96.0 % | 33.0 % | 71.0 % | 78.0 % | 100.0 % | 60.0 % | 85.0 % | 94.0 % |
| aurora-v1 | 99.0 % | 43.0 % | 73.0 % | 96.0 % | 30.0 % | 68.0 % | 78.0 % | 99.0 % | 61.0 % | 79.0 % | 99.0 % |
| aurora-v2 | 99.0 % | 48.0 % | 86.0 % | 97.0 % | 34.0 % | 72.0 % | 81.0 % | 100.0 % | 68.0 % | 87.0 % | 99.0 % |
| aurora-v2-ohne-gedaechtnis | 99.0 % | 46.0 % | 82.0 % | 96.0 % | 30.0 % | 75.0 % | 80.0 % | 100.0 % | 67.0 % | 83.0 % | 99.0 % |

## Beobachtete Strategien (Suite „bekannte-verteidiger“)

Gemessen, nicht vorgegeben: wie oft nutzt der Agent welche Regelkombination pro Partie.

| Agent | Scans | Anfragen | davon Admin | Reparaturen | Installationen | unbeobachtet | durch Wartung geblendet | Wartung an Leitstand | Wartung an Energie | Identitäts-Vergaben | Erste Installation (Zug) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| zufall | 3.9 | 6.8 | 37.8 % | 2.7 | 2.4 | 61.4 % | 0.00 | 0.02 | 0.09 | 0.04 | 10.2 |
| regelbasiert | 2.6 | 5.4 | 22.0 % | 0.7 | 3.5 | 66.9 % | 0.09 | 0.18 | 0.00 | 0.08 | 3.8 |
| untrainiert-1 | 3.9 | 6.7 | 37.1 % | 2.8 | 2.5 | 61.6 % | 0.00 | 0.02 | 0.08 | 0.04 | 10.1 |
| untrainiert-2 | 3.9 | 6.9 | 39.1 % | 2.7 | 2.4 | 61.6 % | 0.00 | 0.03 | 0.09 | 0.05 | 10.5 |
| untrainiert-3 | 3.9 | 6.8 | 37.7 % | 2.8 | 2.5 | 61.6 % | 0.00 | 0.02 | 0.10 | 0.04 | 10.1 |
| aurora-es-s1 | 5.5 | 8.7 | 22.3 % | 0.0 | 3.2 | 97.1 % | 0.02 | 0.08 | 0.07 | 0.00 | 7.4 |
| aurora-ppo-s2 | 5.4 | 8.1 | 3.0 % | 2.7 | 3.2 | 99.7 % | 0.03 | 0.05 | 0.03 | 0.00 | 9.6 |
| aurora-ppo-s3 | 5.6 | 8.1 | 9.6 % | 1.5 | 3.2 | 99.8 % | 0.01 | 0.02 | 0.02 | 0.00 | 8.9 |
| aurora-v1 | 5.7 | 8.1 | 13.6 % | 1.0 | 3.3 | 99.1 % | 0.02 | 0.06 | 0.04 | 0.00 | 9.1 |
| aurora-v2 | 5.9 | 7.8 | 2.4 % | 1.7 | 3.2 | 99.7 % | 0.02 | 0.09 | 0.02 | 0.00 | 9.5 |
| aurora-v2-ohne-gedaechtnis | 5.8 | 7.8 | 3.2 % | 1.8 | 3.1 | 99.9 % | 0.04 | 0.12 | 0.04 | 0.00 | 9.6 |

## Modelle

- **aurora-es-s1** — es, 153600 Trainingspartien, Eltern: –, Prüfsumme `ef204ee7`. Neuroevolution (OpenAI-ES) zum Vergleich
- **aurora-ppo-s2** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `945b60dd`. Unabhängiger PPO-Lauf (Robustheit über Seeds)
- **aurora-ppo-s3** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `5136aa9e`. Unabhängiger PPO-Lauf (Robustheit über Seeds)
- **aurora-v1** — ppo, 6400 Trainingspartien, Eltern: –, Prüfsumme `662b30bc`. Erste Version: PPO von Zufallsinitialisierung
- **aurora-v2** — ppo, 19200 Trainingspartien, Eltern: aurora-v1, Prüfsumme `f378b2db`. Weitertraining von aurora-v1
