# Next Steps

## Aktueller Stand

ME-7741 ist als spielbarer MVP umgesetzt (siehe `04-me7741-mvp.md`): Drei-Zonen-UI, sektoragnostische Runtime, Routing-Override-Flow, AURORA-Scenario-Director, Permission-Flow, Reset sowie Win-/Loss-Zustände. Tests und Build sind grün.

## Sinnvolle nächste Schritte

### Playtest & Balancing von ME-7741

Die aktuellen Schwellenwerte (`STABLE_TICKS_TO_FIX = 10`, `OVERLOAD_TICKS_PER_DEATH = 3`, `MISMATCH_TICKS_PER_DEATH = 4`, Eskalation ab 1 Tod, Kollaps ab 3 Toten — siehe `03-runtime-architecture.md`) sind funktional, aber nicht spielerisch getestet. Spielgefühl, Tempo bis zur ersten Konsequenz und Lesbarkeit der AURORA-Hinweise sollten in echten Durchläufen geprüft werden.

### Incident 2 — Energy-Domain (GRID-1182)

Die Runtime ist dafür bereits vorbereitet, aber **nicht** fachlich modelliert:

- `DomainState.energy?: EnergyDomainState` existiert als Typ-Platzhalter (`EnergyDomainState = never`).
- `simulation.cross_sector.effects_applied` und der Pipeline-Schritt `applyCrossSectorEffects` existieren bereits als No-op und sind der vorgesehene Ort für sektorübergreifende Effekte (z. B. Energy-Ausfall → reduzierte Hospital-Kapazität).
- `SectorId` enthält `"energy"` bereits als Wert.

Offen für Incident 2: konkreter `EnergyDomainState`, Initial-WorldState für GRID-1182, Energy-Commands, Energy-Outcome-Regeln, erste echte Cross-Sector-Effekte, UI-Panels für Energy und ein eigener Scenario-Director. Wichtig dabei: Energy soll nicht als "Hospital mit anderem Namen" modelliert werden, sondern eigene fachliche Konzepte (Netzlast, Knoten, Lastabwurf, Kaskadenrisiko) bekommen, die sich dieselbe Infrastruktur (Commands, Permissions, Patches, Ticks, Incidents, Outcomes) teilen.

### AURORA als LLM-Agent

Der Scenario-Director ist bewusst so geschnitten, dass er später durch einen echten LLM-Agenten ersetzt werden kann, ohne Permission-Flow, Tick-Pipeline oder UI zu ändern (siehe `01-aurora.md`, „Langfristige Vision").
