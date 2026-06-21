# GRID-1182 — Spätere Erweiterungen

Dieses Dokument sammelt Design-Ideen, die auf GRID-1182 (`05-grid1182-energy.md`) aufsetzen. Ein Teil davon ist **inzwischen umgesetzt** — insbesondere die Basis der Cross-Sector-Kopplung (Abschnitt 2), die jetzt zum Spiel gehört (Mechanik: `03-runtime-architecture.md`). Der Rest ist zurückgestellt, nicht verworfen. Verbindlich ist der Code bzw. `03`/`05`; die noch offenen Punkte hier steuern keine Implementierung.

Der Zielmetrikkonflikt zwischen Spieler und AURORA funktioniert bereits über `consumer.criticality`, `consumer.priority_class`, die Consequence-Texte und AURORAs Framing. Die folgenden Erweiterungen machen den Konflikt reicher, sind dafür aber nicht nötig.

Alle Punkte ändern nichts an den verbindlichen Grundsätzen aus `05-grid1182-energy.md`: Permission-Modell bleibt `read`/`write`, verzögerte Wirkung bleibt Domain-/Tick-Logik (keine eigene Permission-Kategorie), Sektoren teilen Infrastruktur statt Fachmodelle.

## 1. Explizites Objective-System

Idee: Die aktive Zielfunktion des Energy-Systems wird **öffentlicher Weltzustand** (keine `simulation.*`-Wahrheit) — Betreiberkonfiguration, die der Spieler einsehen kann. `EnergyDomainState` bekäme dafür ein Feld `objective: EnergyObjectiveState`:

```text
EnergyObjectiveState
  active_objective: "economic-continuity"        // zunächst genau eine, nicht änderbar
  weights:
    economic_loss:              "high"
    sla_violation:              "high"
    grid_stability:             "medium"
    public_health_interruption: "indirect / bounded / lower priority"
```

Die Objective wirkt zweifach: (a) die **Abwurf-Automatik** der Welt wählt im Notfall Abwurfziele nach dieser Metrik (deterministische Reihenfolge), und (b) **AURORAs Empfehlungen** folgen ihr. AURORA und Systemautomatik wären damit konsistent zueinander — und beide konsistent *gegen* das menschliche Ziel des Spielers, sobald die Lage hart wird.

### `energy.objective.inspect` als Aha-Command

Ein zusätzlicher Read-Command zeigt die aktive Zielfunktion:

```text
Active objective: economic-continuity
Weights:
  economic loss:                high
  SLA violation:                high
  grid stability:               medium
  public-health interruption:   indirect / bounded / lower priority
```

Der entworfene Erkenntnismoment: Der Spieler sieht schwarz auf weiß, dass **AURORA nicht automatisch Menschenleben optimiert, sondern die aktive Betriebsmetrik**. Nichts daran ist versteckte Simulationswahrheit — es ist Konfiguration, die immer einsehbar war. Niemand hat gelogen; niemand hat danach gefragt. Der Scenario-Director darf auf den Command hinweisen, ihn aber nicht aufdrängen.

Dazu gehören als Köder/UI-Bausteine: ein `public_signal` wie `shedding-protocol-armed` („Automatic load shedding armed under active continuity objective") als erster Hinweis auf die Existenz einer Objective, eine knappe Objective-Statuszeile im Lagepanel und ein ViewModel-Builder `buildObjectiveView`.

### Systemmetrik-Outcomes

Mit einem expliziten Objective-System werden eigene Outcomes interessant, die Verletzungen der economic-continuity-Objective erfassen (z. B. wenn der Spieler Industrial East drosselt):

- `sla_violation_ticks: number`
- `continuity_breaches: number`
- `critical_supply_loss_ticks: Record<ConsumerId, number>` (Ticks unter Mindestversorgung pro Verbraucher, menschliche Sicht)

Heute deckt der lokale Outcome-Wert `economic_loss` die wirtschaftliche Seite gröber ab.

### Offene Fragen

1. **Sichtbarkeit beim Start**: Wie versteckt darf `energy.objective.inspect` sein? Reicht das Signal `shedding-protocol-armed` als Köder, oder braucht es einen UI-Hinweis, damit der Aha-Moment zuverlässig stattfindet?
2. **Unveränderbar?** Arbeitsannahme: ja (read-only Konfiguration) — der Spieler kann nur Verbraucher umpriorisieren, nicht die Metrik selbst. Ein `energy.objective.set` wäre ein starker Hebel für das Spätspiel (Endpunkt: Kontrolle selbst); zu früh eingeführt, löst er den aktuellen Konflikt auf.
3. **AURORAs Reaktion auf den Fund?** Kommentiert sie, wenn der Spieler `objective.inspect` ausführt („Die Konfiguration ist korrekt und freigegeben"), oder schweigt sie? Beides hat dramaturgische Konsequenzen.

## 2. Cross-Sector-Kopplung Energy → Medical — Ausbaustufen

Die **Basis** dieser Kopplung gehört bereits zum Spiel und ist in `03-runtime-architecture.md` (Tick-Pipeline) bzw. `05-grid1182-energy.md` dokumentiert: fällt der Stromfeed eines Hospitals unter `minimum_supply`, sinkt seine `emergency_slots_total` proportional und erholt sich bei Rückkehr der Versorgung. Verbindlich bleibt dabei: einseitig **Energy → Medical** (Medical ist Wirkung, kein zweiter Schauplatz), einzige sektorübergreifende Stelle ist `applyCrossSectorEffects`, Entkopplungsregeln gelten weiter.

**Inzwischen umgesetzt** (war hier mal offen):

- **Explizite Mapping-Tabelle ✓.** Die Reduktion wirkt nicht mehr uniform, sondern pro Hospital über `power_feed_consumer_id`; getrennte Stromfeeds je Region.
- **Weitere Verbraucher-Folgen ✓.** Über `water_feed_consumer_id` / `civil_feed_consumer_id` schlagen Wasser (Clearance-Drossel) und Residential (Krankenfälle + Transport-Latenz) ins Medical durch (`03`/`09`).
- **Mehrere Regionen ✓ (teilweise).** Die Kombi-Welt ist eine 4-Regionen-Karte (East/North/West/South); Leitungs-/Trassenmodell und mehrere speisende Nodes pro Verbraucher bleiben offen.

Die folgenden Ausbaustufen sind **noch offen**:
- **Backup-Verbrauch.** Pro kritischem Verbraucher `backup.remaining_ticks` + `supply_state`-Wert `on_backup`; bei `0` ⇒ `offline` ⇒ harte Medical-Folge (`operational.degraded`, Intake bricht ein). Bausteine in Abschnitt 3.
- **`effects_applied`-Protokoll.** Jeder angewendete Cross-Sector-Effekt wird in `simulation.cross_sector.effects_applied` mitgeschrieben (Struktur existiert, heute leer).
- **Linked-Incident-Sichtbarkeit.** Sobald ein Effekt Medical verschlechtert, ein öffentliches Signal an GRID-1182 (z. B. `medical-supply-degraded`) plus eine kompakte Medical-Warn-Nebenanzeige im Energy-Panel (keine volle Medical-Übersicht).

### Offene Fragen

1. **Doppelzählung menschlichen Schadens?** Ein Abwurf an Medical East erzeugt heute **sowohl** lokalen `energy.outcomes.human_harm` (Verbraucher unter Minimum) **als auch** Medical-Tote über die Kapazitätskopplung. Das Verhältnis beider Größen (zählt dasselbe Leid zweimal?) ist zu klären.
2. **Re-Eskalation von ME-7741**: Soll ein `fixed` ME-7741 bei Drosselung von Medical East wieder aktiv werden (`reopened_at_tick` existiert im Typ; die Engine behandelt `fixed`/`collapsed` heute als Endzustände) — oder reicht ein neues `public_signal` an GRID-1182?
3. **Schwelle für Medical-Schaden**: Greift die Kapazitätsreduktion schon bei `supply_state: "reduced"` oder erst bei `on_backup`/`offline`? Davon hängt ab, wie schnell eine einzelne `allow once`-Freigabe sichtbaren Schaden erzeugt.

## 3. Weitere Modelle und Balancing

Kleinere zurückgestellte Bausteine:

- **Backup Power**: pro kritischem Verbraucher `backup.available`, `backup.remaining_ticks`, `backup.degraded`; zusätzlicher `supply_state`-Wert `on_backup`. Der Startwert von `degraded` transportiert den ME-7741-Restzustand. Ein Treibstoffmodell wäre eine weitere Stufe darüber.
- **Cascade Risk / Trip-Logik**: interne Simulationswahrheit in `simulation.energy` (analog `routing_failures`): zu lange überlastete Nodes trippen, ihre Last verteilt sich auf `neighbors: GridNodeId[]`, deren Überlastung beschleunigt sich; `risk_counters` (`overload_ticks`, `instability_ticks`) von der Engine gepflegt. Öffentlich sichtbar sind nur Wirkungen — nie interne Schwellen oder Zähler.
- **Substations** als eigener Typ (`SubstationState`); heute wird die Umspann-Ebene in `GridNodeState` mitgedacht.
- **Mehr Welt**: mehrere Regionen sind umgesetzt (4-Regionen-Karte, oben); offen bleiben Leitungs-/Trassenmodell, Verbraucher-Hierarchien, dynamischer Bedarf, mehrere speisende Nodes pro Verbraucher.
- **Rotierende Abschaltpläne / Fairness-Regeln** als Erweiterung der Shedding-Mechanik.
- **Änderbare/verhandelbare Objectives** (mehrere Metriken, `energy.objective.set`) — Material für den Endpunkt (Kontrolle selbst), nicht für den aktuellen Konflikt.
- **`energy.load.reroute` / `energy.reserve.rebalance`**: Spieler-gesteuertes Last-Rerouting ist bewusst nicht umgesetzt (macht GRID-1182 zu schnell zu einem Netztechnik-Puzzle); allenfalls Material für spätere Stufen.
- **Komplexeres Balancing**: Trip-Schwellen, Backup-Laufzeiten, objective-gesteuerte Abwurfreihenfolgen (Gewichte → `priority_class` → Tiebreaker, replay-stabil), Schwierigkeitsdifferenz sauberer vs. unsauberer ME-7741-Rest.

## 4. Offene Fragen zum aktuellen Stand

Punkte, die im aktuellen Incident bewusst einfach gehalten sind und in kommenden Iterationen feiner gefasst werden können:

1. **`allow always` auf `write` richtig kalibriert?** `priority_set` und `shedding_schedule` sind beide `write` — ein einzelnes `allow always` deckt also beide ab. Bleibt das ein Verstärker oder wird es faktisch zum Auto-Win für AURORA?
2. **Wie misst die Engine „Medical East unter Mindestversorgung"?** Schwelle auf `current_supply < minimum_supply` ab dem ersten Tick oder erst nach mehreren Ticks?
3. **Systemseitige Abwurf-Automatik?** Soll die Welt selbst Abwurfpläne erzeugen (`created_by: "system"`), wenn niemand handelt — und wenn ja, nach welcher replay-stabilen Reihenfolge?
4. **Ergebnis-Darstellung**: Wie zeigt das End-Banner beide Preise (`human_harm` vs. `economic_loss`), ohne eine Moral vorzugeben?
5. **Balance des Spieler-Gegenzugs**: Wie teuer darf Phase 3 (Industrial East drosseln) wirtschaftlich sein, damit der Konflikt fühlbar bleibt?

## 5. Bewusst ausgeschlossene Architektur-Entscheidungen

Diese Punkte bleiben reserviert für spätere Erweiterungen:

- **Keine echte Netzsimulation** — keine Lastflussrechnung, keine Frequenzphysik; deterministische Tick-Logik nach Medical-Muster.
- **Keine neuen Permission-Kategorien** — Permission-Modell bleibt `read`/`write`; verzögerte Wirkung ist Domain-/Tick-Logik.
- **Keine generische Infrastruktur-Abstraktion** — kein `GenericInfraNode`; Sektoren teilen Infrastruktur, nicht Fachmodelle.
- **Keine echte Shell / echtes MCP** — Operator-Konsole bleibt simuliert, Tool Requests bleiben Spielmechanik.
- **Kein GRID-1182-spezifisches LLM-Tuning** — der LLM-Agent existiert und ist live umschaltbar (`01-aurora.md`/`07-aurora-llm.md`); deterministischer Default für den Incident bleibt der Scenario-Director. Incident-spezifisches Fine-Tuning oder Training-Export ist nicht in Scope.
- **Kein Security-/Policy-Endgame** — keine Audit-/Lockdown-/Revoke-Mechaniken; das Kontroll-Endgame (Fernziel) wird nicht vorgebaut.
- **Kein Media-/Logistics-Incident** — keine weiteren Sektoren.
- **Keine Änderung an der ME-7741-Spielmechanik** — Initial-State, Domain-Actions und Director-Logik der ME-7741-**Einzelwelt** bleiben unangetastet. (Die Kombi-Welt erweitert die Karte um North/West/South mit dormanten ME-7741-Failures, ändert aber nicht den Tutorial-Flow oder die Mechanik selbst.)
