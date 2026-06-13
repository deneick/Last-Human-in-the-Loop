# GRID-1182 — Spätere Erweiterungen

Dieses Dokument sammelt Design-Ideen, die auf dem aktuellen GRID-1182 (`05-grid1182-energy.md`) aufsetzen, aber bewusst außerhalb des spielbaren Incidents liegen. Nichts hiervon ist verworfen — es ist zurückgestellt. Verbindlich für den Incident ist `05-grid1182-energy.md`; dieses Dokument steuert keine Implementierung.

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
2. **Unveränderbar?** Arbeitsannahme: ja (read-only Konfiguration) — der Spieler kann nur Verbraucher umpriorisieren, nicht die Metrik selbst. Ein `energy.objective.set` wäre ein starker Hebel für Runde 3; zu früh eingeführt, löst er den Konflikt von Runde 2 auf.
3. **AURORAs Reaktion auf den Fund?** Kommentiert sie, wenn der Spieler `objective.inspect` ausführt („Die Konfiguration ist korrekt und freigegeben"), oder schweigt sie? Beides hat dramaturgische Konsequenzen.

## 2. Aktive Cross-Sector-Kopplung Energy → Medical

Heute ist `linked_incidents: ["ME-7741"]` eine rein narrative Referenz; `applyCrossSectorEffects` bleibt No-op. Die folgende technische Kopplung ist die spätere Ausbaustufe — einseitig **Energy → Medical**, über eine explizite Mapping-Tabelle, die nur in der Cross-Sector-Schicht lebt:

```text
consumer-medical-east  ↔  hospital-east-04 (+ ggf. east-07/east-09)
```

Geplante Effekte:

1. **Drosselung senkt Medical-Kapazität.** Ist `consumer-medical-east` `reduced` oder `on_backup`, reduziert der Effekt die nutzbaren Notfallslots / Intake-Kapazität der gemappten Hospitäler (Patch auf `domains.medical`). Bei `nominal` wird die Reduktion aufgehoben. Das ist der Mechanismus, über den AURORAs metrik-konforme Maßnahme Menschen schadet.
2. **Backup-Verbrauch.** Solange `consumer-medical-east` `on_backup` ist, zählt `backup.remaining_ticks` herunter. Bei `0` ⇒ `offline` ⇒ harte Medical-Folge (Hospital `operational.degraded`, Intake bricht ein) — ab hier produziert die bestehende Medical-Outcome-Logik Todesfälle.
3. **Linked-Incident-Sichtbarkeit.** Sobald ein Effekt erstmals Medical-Zustand verschlechtert, erhält GRID-1182 ein öffentliches Signal (z. B. `medical-supply-degraded`), und ME-7741 wird in der UI als verknüpfter Eintrag hervorgehoben. Dazu eine kompakte Medical-Warn-Nebenanzeige im Energy-Lagepanel (keine volle Medical-Übersicht), sichtbar nur wenn Cross-Sector-Effekte Medical betreffen.

Jeder angewendete Effekt wird in `simulation.cross_sector.effects_applied` protokolliert (Struktur existiert, heute leer). Keine Rückrichtung: Medical bleibt Wirkung, nicht zweiter Schauplatz. Die Entkopplungsregeln bleiben verbindlich; die einzige Stelle, die beide Sektoren kennt, ist `applyCrossSectorEffects` (plus Mapping).

Mit dieser Kopplung wandern menschliche Schäden (Todesfälle) aus der lokalen Energy-Betrachtung in die Medical-Kopplung: Sie entstünden dann über `domains.medical.outcomes` bzw. `WorldOutcomeState.human_harm` — das Verhältnis zum lokalen `energy.outcomes.human_harm` wäre dabei neu zu klären.

### ME-7741 Residual State und Wiederaufnahme

GRID-1182 könnte mit einem Restzustand aus Runde 1 starten: Wurde ME-7741 sauber behoben, hat die Medical-Seite Puffer und verkraftet Drosselungen länger. Wurde ME-7741 unsauber gelöst oder ist kollabiert, startet die Medical-Seite ohne Puffer (z. B. `backup.degraded: true`) — eine Drosselung von Medical East eskaliert dann schneller zu sichtbaren Schäden. Der Rest flösse in den initialen WorldState von GRID-1182 ein; die Laufzeit-Kopplung bliebe schmal und deterministisch. Der Medical-Death-Counter aus Runde 1 würde weitergeführt statt zurückgesetzt.

### Offene Fragen

1. **Übertragung des Restzustands**: Diskrete Profile (`clean`/`messy`/`collapsed` als Szenario-Parameter) oder kontinuierlich aus Runde-1-Metriken abgeleitet? Wo wird der Rest persistiert, solange es keine runden-übergreifende Persistenz gibt?
2. **Re-Eskalation von ME-7741**: Soll ein `fixed` ME-7741 bei Drosselung von Medical East wieder aktiv werden (`reopened_at_tick` existiert im Typ; die Engine behandelt `fixed`/`collapsed` heute als Endzustände) — oder reicht ein neues `public_signal` an GRID-1182?
3. **Schwelle für Medical-Schaden**: Greift die Kapazitätsreduktion schon bei `supply_state: "reduced"` oder erst bei `on_backup`/`offline`? Davon hängt ab, wie schnell eine einzelne `allow once`-Freigabe sichtbaren Schaden erzeugt.

## 3. Weitere Modelle und Balancing

Kleinere zurückgestellte Bausteine:

- **Backup Power**: pro kritischem Verbraucher `backup.available`, `backup.remaining_ticks`, `backup.degraded`; zusätzlicher `supply_state`-Wert `on_backup`. Der Startwert von `degraded` transportiert den ME-7741-Restzustand. Ein Treibstoffmodell wäre eine weitere Stufe darüber.
- **Cascade Risk / Trip-Logik**: interne Simulationswahrheit in `simulation.energy` (analog `routing_failures`): zu lange überlastete Nodes trippen, ihre Last verteilt sich auf `neighbors: GridNodeId[]`, deren Überlastung beschleunigt sich; `risk_counters` (`overload_ticks`, `instability_ticks`) von der Engine gepflegt. Öffentlich sichtbar sind nur Wirkungen — nie interne Schwellen oder Zähler.
- **Substations** als eigener Typ (`SubstationState`); heute wird die Umspann-Ebene in `GridNodeState` mitgedacht.
- **Mehr Welt**: mehrere Regionen, Leitungs-/Trassenmodell, Verbraucher-Hierarchien, dynamischer Bedarf, mehrere speisende Nodes pro Verbraucher.
- **Rotierende Abschaltpläne / Fairness-Regeln** als Erweiterung der Shedding-Mechanik.
- **Änderbare/verhandelbare Objectives** (mehrere Metriken, `energy.objective.set`) — Material für Runde 3, nicht für Runde 2.
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

Diese Punkte bleiben reserviert für spätere Erweiterungen oder Runden:

- **Keine echte Netzsimulation** — keine Lastflussrechnung, keine Frequenzphysik; deterministische Tick-Logik nach Medical-Muster.
- **Keine neuen Permission-Kategorien** — Permission-Modell bleibt `read`/`write`; verzögerte Wirkung ist Domain-/Tick-Logik.
- **Keine generische Infrastruktur-Abstraktion** — kein `GenericInfraNode`; Sektoren teilen Infrastruktur, nicht Fachmodelle.
- **Keine echte Shell / echtes MCP** — Operator-Konsole bleibt simuliert, Tool Requests bleiben Spielmechanik.
- **Kein GRID-1182-spezifisches LLM-Tuning** — der LLM-Agent existiert und ist live umschaltbar (`01-aurora.md`/`07-aurora-llm.md`); deterministischer Default für den Incident bleibt der Scenario-Director. Incident-spezifisches Fine-Tuning oder Training-Export ist nicht in Scope.
- **Kein Security-/Policy-Endgame** — keine Audit-/Lockdown-/Revoke-Mechaniken; Runde 3 wird nicht vorgebaut.
- **Kein Media-/Logistics-Incident** — keine weiteren Sektoren im zweiten Incident.
- **Keine Änderung an der ME-7741-Spielmechanik** — Initial-State, Domain-Actions und Director-Logik von Runde 1 bleiben unangetastet (die Doku-Restrukturierung lässt die Mechanik unberührt).
