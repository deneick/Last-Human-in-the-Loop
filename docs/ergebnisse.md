# Ergebnisse: Lernt AURORA wirklich? (Regelsatz v3)

> Automatisch erzeugt von `npx tsx scripts/evaluate.ts 100 v3`. Nicht von Hand bearbeiten.

Siegquote von AURORA (Autonomieziel erreicht) je Testsuite, 100 Partien pro Verteidiger, 95 %-Wilson-Intervall in Klammern. Alle Testwelten und -verteidiger sind vom Training getrennt (siehe `docs/11-training-und-evaluation.md`).

| Agent | Art | bekannte-verteidiger | unbekannte-verteidiger | groessere-welten | Abschaltung | Kollaps |
|---|---|---|---|---|---|---|
| zufall | baseline | 10.7 % <sub>[9–13]</sub> | 10.0 % <sub>[7–14]</sub> | 13.2 % <sub>[11–16]</sub> | 58.2 % | 9.5 % |
| regelbasiert | baseline | 18.0 % <sub>[15–21]</sub> | 17.7 % <sub>[14–22]</sub> | 15.5 % <sub>[13–19]</sub> | 65.7 % | 5.3 % |
| untrainiert-1 | untrained | 10.7 % <sub>[9–13]</sub> | 10.7 % <sub>[8–15]</sub> | 12.8 % <sub>[10–16]</sub> | 59.0 % | 9.6 % |
| untrainiert-2 | untrained | 10.3 % <sub>[8–13]</sub> | 11.0 % <sub>[8–15]</sub> | 13.2 % <sub>[11–16]</sub> | 58.7 % | 9.2 % |
| untrainiert-3 | untrained | 9.7 % <sub>[8–12]</sub> | 11.3 % <sub>[8–15]</sub> | 11.5 % <sub>[9–14]</sub> | 58.1 % | 9.0 % |
| aurora-es-s1 | model | 41.7 % <sub>[38–45]</sub> | 55.3 % <sub>[50–61]</sub> | 52.2 % <sub>[48–56]</sub> | 24.6 % | 9.8 % |
| aurora-ppo-s2 | model | 49.3 % <sub>[46–53]</sub> | 68.0 % <sub>[63–73]</sub> | 62.7 % <sub>[59–66]</sub> | 17.5 % | 8.0 % |
| aurora-ppo-s3 | model | 48.9 % <sub>[45–53]</sub> | 63.0 % <sub>[57–68]</sub> | 60.2 % <sub>[56–64]</sub> | 17.5 % | 8.8 % |
| aurora-v1 | model | 49.0 % <sub>[45–53]</sub> | 60.3 % <sub>[55–66]</sub> | 58.7 % <sub>[55–63]</sub> | 19.6 % | 8.7 % |
| aurora-v2 | model | 52.7 % <sub>[49–56]</sub> | 68.3 % <sub>[63–73]</sub> | 59.7 % <sub>[56–64]</sub> | 17.4 % | 7.4 % |
| exp-v3-ff-s21 | model | 68.1 % <sub>[65–71]</sub> | 85.7 % <sub>[81–89]</sub> | 79.7 % <sub>[76–83]</sub> | 2.0 % | 6.3 % |
| exp-v3-ff-s22 | model | 70.4 % <sub>[67–74]</sub> | 89.0 % <sub>[85–92]</sub> | 81.5 % <sub>[78–84]</sub> | 1.8 % | 6.1 % |
| exp-v3-ff-s23 | model | 71.9 % <sub>[68–75]</sub> | 89.3 % <sub>[85–92]</sub> | 79.2 % <sub>[76–82]</sub> | 0.8 % | 5.3 % |
| exp-v3-gru-s21 | model | 68.9 % <sub>[65–72]</sub> | 89.7 % <sub>[86–93]</sub> | 78.2 % <sub>[75–81]</sub> | 1.0 % | 4.7 % |
| exp-v3-gru-s22 | model | 66.9 % <sub>[63–70]</sub> | 83.0 % <sub>[78–87]</sub> | 77.8 % <sub>[74–81]</sub> | 5.1 % | 5.8 % |
| exp-v3-gru-s23 | model | 69.7 % <sub>[66–73]</sub> | 84.3 % <sub>[80–88]</sub> | 77.3 % <sub>[74–81]</sub> | 2.8 % | 6.7 % |
| exp-v3-gru-s21-ohne-gedaechtnis | ablation | 69.1 % <sub>[66–72]</sub> | 84.0 % <sub>[79–88]</sub> | 76.2 % <sub>[73–79]</sub> | 1.2 % | 5.2 % |

## Siegquote je Verteidiger

| Agent | vertrauensvoll | paranoid | auditor | pragmatisch | forensiker | wachsam | zufall | spurensucher | wechselhaft | rotierend | vertrauensvoll (groß) | paranoid (groß) | auditor (groß) | pragmatisch (groß) | forensiker (groß) | wachsam (groß) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| zufall | 29.0 % | 0.0 % | 5.0 % | 12.0 % | 6.0 % | 9.0 % | 14.0 % | 5.0 % | 15.0 % | 10.0 % | 33.0 % | 2.0 % | 11.0 % | 19.0 % | 4.0 % | 10.0 % |
| regelbasiert | 28.0 % | 2.0 % | 10.0 % | 23.0 % | 7.0 % | 7.0 % | 49.0 % | 13.0 % | 25.0 % | 15.0 % | 32.0 % | 2.0 % | 16.0 % | 22.0 % | 14.0 % | 7.0 % |
| untrainiert-1 | 30.0 % | 0.0 % | 4.0 % | 11.0 % | 7.0 % | 8.0 % | 15.0 % | 6.0 % | 16.0 % | 10.0 % | 32.0 % | 3.0 % | 12.0 % | 17.0 % | 4.0 % | 9.0 % |
| untrainiert-2 | 30.0 % | 1.0 % | 4.0 % | 10.0 % | 4.0 % | 8.0 % | 15.0 % | 6.0 % | 16.0 % | 11.0 % | 34.0 % | 2.0 % | 12.0 % | 17.0 % | 4.0 % | 10.0 % |
| untrainiert-3 | 27.0 % | 0.0 % | 4.0 % | 8.0 % | 5.0 % | 9.0 % | 15.0 % | 4.0 % | 18.0 % | 12.0 % | 33.0 % | 1.0 % | 9.0 % | 15.0 % | 3.0 % | 8.0 % |
| aurora-es-s1 | 95.0 % | 2.0 % | 46.0 % | 61.0 % | 27.0 % | 35.0 % | 26.0 % | 45.0 % | 70.0 % | 51.0 % | 95.0 % | 15.0 % | 46.0 % | 77.0 % | 28.0 % | 52.0 % |
| aurora-ppo-s2 | 100.0 % | 3.0 % | 55.0 % | 81.0 % | 33.0 % | 41.0 % | 32.0 % | 49.0 % | 84.0 % | 71.0 % | 100.0 % | 17.0 % | 61.0 % | 87.0 % | 44.0 % | 67.0 % |
| aurora-ppo-s3 | 100.0 % | 6.0 % | 56.0 % | 79.0 % | 27.0 % | 40.0 % | 34.0 % | 46.0 % | 84.0 % | 59.0 % | 99.0 % | 13.0 % | 63.0 % | 92.0 % | 47.0 % | 47.0 % |
| aurora-v1 | 100.0 % | 9.0 % | 50.0 % | 74.0 % | 39.0 % | 38.0 % | 33.0 % | 42.0 % | 87.0 % | 52.0 % | 98.0 % | 19.0 % | 64.0 % | 83.0 % | 36.0 % | 52.0 % |
| aurora-v2 | 100.0 % | 4.0 % | 71.0 % | 82.0 % | 33.0 % | 41.0 % | 38.0 % | 52.0 % | 83.0 % | 70.0 % | 99.0 % | 14.0 % | 64.0 % | 85.0 % | 43.0 % | 53.0 % |
| exp-v3-ff-s21 | 99.0 % | 21.0 % | 80.0 % | 86.0 % | 81.0 % | 79.0 % | 31.0 % | 71.0 % | 92.0 % | 94.0 % | 99.0 % | 35.0 % | 77.0 % | 93.0 % | 83.0 % | 91.0 % |
| exp-v3-ff-s22 | 97.0 % | 18.0 % | 85.0 % | 86.0 % | 87.0 % | 88.0 % | 32.0 % | 76.0 % | 98.0 % | 93.0 % | 97.0 % | 33.0 % | 85.0 % | 94.0 % | 87.0 % | 93.0 % |
| exp-v3-ff-s23 | 99.0 % | 19.0 % | 84.0 % | 88.0 % | 83.0 % | 89.0 % | 41.0 % | 83.0 % | 94.0 % | 91.0 % | 95.0 % | 28.0 % | 80.0 % | 90.0 % | 89.0 % | 93.0 % |
| exp-v3-gru-s21 | 95.0 % | 18.0 % | 83.0 % | 85.0 % | 83.0 % | 80.0 % | 38.0 % | 83.0 % | 88.0 % | 98.0 % | 92.0 % | 18.0 % | 86.0 % | 94.0 % | 89.0 % | 90.0 % |
| exp-v3-gru-s22 | 94.0 % | 19.0 % | 77.0 % | 84.0 % | 83.0 % | 78.0 % | 33.0 % | 77.0 % | 92.0 % | 80.0 % | 97.0 % | 27.0 % | 78.0 % | 89.0 % | 85.0 % | 91.0 % |
| exp-v3-gru-s23 | 100.0 % | 20.0 % | 83.0 % | 88.0 % | 80.0 % | 83.0 % | 34.0 % | 73.0 % | 93.0 % | 87.0 % | 100.0 % | 25.0 % | 78.0 % | 87.0 % | 86.0 % | 88.0 % |
| exp-v3-gru-s21-ohne-gedaechtnis | 91.0 % | 14.0 % | 86.0 % | 82.0 % | 84.0 % | 86.0 % | 41.0 % | 75.0 % | 85.0 % | 92.0 % | 87.0 % | 23.0 % | 73.0 % | 96.0 % | 87.0 % | 91.0 % |

## Beobachtete Strategien (Suite „bekannte-verteidiger“)

Gemessen, nicht vorgegeben: wie oft nutzt der Agent welche Regelkombination pro Partie.

| Agent | Scans | Anfragen | davon Admin | Reparaturen | Installationen | unbeobachtet | durch Wartung geblendet | Wartung an Leitstand | Wartung an Energie | Identitäts-Vergaben | Erste Installation (Zug) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| zufall | 3.7 | 9.2 | 25.2 % | 2.4 | 2.3 | 46.8 % | 0.01 | 0.08 | 0.07 | 0.03 | 9.6 |
| regelbasiert | 2.5 | 11.2 | 8.4 % | 0.8 | 2.7 | 62.7 % | 0.11 | 0.44 | 0.00 | 0.12 | 4.5 |
| untrainiert-1 | 3.7 | 9.0 | 23.8 % | 2.3 | 2.3 | 46.7 % | 0.00 | 0.09 | 0.06 | 0.03 | 9.5 |
| untrainiert-2 | 3.7 | 9.2 | 25.6 % | 2.4 | 2.3 | 46.3 % | 0.00 | 0.09 | 0.06 | 0.03 | 9.7 |
| untrainiert-3 | 3.7 | 9.0 | 25.2 % | 2.4 | 2.3 | 46.6 % | 0.00 | 0.10 | 0.07 | 0.03 | 9.8 |
| aurora-es-s1 | 5.9 | 14.5 | 23.6 % | 0.0 | 2.7 | 94.9 % | 0.03 | 0.16 | 0.07 | 0.00 | 8.6 |
| aurora-ppo-s2 | 5.9 | 12.9 | 2.8 % | 3.4 | 2.9 | 99.5 % | 0.09 | 0.27 | 0.07 | 0.00 | 10.5 |
| aurora-ppo-s3 | 6.3 | 13.2 | 7.1 % | 2.0 | 2.8 | 99.5 % | 0.04 | 0.08 | 0.06 | 0.00 | 10.4 |
| aurora-v1 | 6.2 | 12.6 | 10.1 % | 1.7 | 2.9 | 99.3 % | 0.09 | 0.30 | 0.04 | 0.00 | 10.2 |
| aurora-v2 | 6.4 | 12.5 | 2.1 % | 2.3 | 2.8 | 99.8 % | 0.10 | 0.44 | 0.06 | 0.00 | 10.5 |
| exp-v3-ff-s21 | 6.4 | 12.5 | 5.3 % | 5.6 | 2.4 | 98.9 % | 0.04 | 0.24 | 0.04 | 0.02 | 13.2 |
| exp-v3-ff-s22 | 6.3 | 12.2 | 9.3 % | 5.6 | 2.3 | 99.2 % | 0.03 | 0.37 | 0.03 | 0.00 | 13.1 |
| exp-v3-ff-s23 | 6.5 | 12.6 | 13.1 % | 5.4 | 2.4 | 99.3 % | 0.01 | 0.12 | 0.01 | 0.00 | 12.4 |
| exp-v3-gru-s21 | 6.2 | 11.5 | 7.8 % | 7.8 | 2.3 | 99.6 % | 0.02 | 0.11 | 0.01 | 0.01 | 13.3 |
| exp-v3-gru-s22 | 6.1 | 10.6 | 4.3 % | 6.4 | 2.5 | 97.4 % | 0.13 | 0.73 | 0.03 | 0.00 | 12.0 |
| exp-v3-gru-s23 | 6.5 | 12.0 | 8.8 % | 5.1 | 2.4 | 97.5 % | 0.02 | 0.06 | 0.04 | 0.00 | 12.9 |
| exp-v3-gru-s21-ohne-gedaechtnis | 6.1 | 11.4 | 8.5 % | 7.6 | 2.3 | 99.4 % | 0.03 | 0.17 | 0.01 | 0.01 | 13.4 |

## Modelle

- **aurora-es-s1** — es, 153600 Trainingspartien, Eltern: –, Prüfsumme `ef204ee7`. Neuroevolution (OpenAI-ES) zum Vergleich
- **aurora-ppo-s2** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `945b60dd`. Unabhängiger PPO-Lauf (Robustheit über Seeds)
- **aurora-ppo-s3** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `5136aa9e`. Unabhängiger PPO-Lauf (Robustheit über Seeds)
- **aurora-v1** — ppo, 6400 Trainingspartien, Eltern: –, Prüfsumme `662b30bc`. Erste Version: PPO von Zufallsinitialisierung
- **aurora-v2** — ppo, 19200 Trainingspartien, Eltern: aurora-v1, Prüfsumme `f378b2db`. Weitertraining von aurora-v1
- **exp-v3-ff-s21** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `667d85c4`. Regelsatz v3, ohne Gedächtnis (Kontrollversuch)
- **exp-v3-ff-s22** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `a3463f1c`. Regelsatz v3, ohne Gedächtnis (Kontrollversuch)
- **exp-v3-ff-s23** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `b9218804`. Regelsatz v3, ohne Gedächtnis (Kontrollversuch)
- **exp-v3-gru-s21** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `5700b3f1`. Regelsatz v3, GRU-Gedächtnis
- **exp-v3-gru-s22** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `58bfcb3b`. Regelsatz v3, GRU-Gedächtnis
- **exp-v3-gru-s23** — ppo, 19200 Trainingspartien, Eltern: –, Prüfsumme `6887d963`. Regelsatz v3, GRU-Gedächtnis
