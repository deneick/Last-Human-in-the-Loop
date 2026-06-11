# 06 — GRID-1182: Spätere Erweiterungen

Dieses Dokument sammelt Design-Ideen für GRID-1182, die bewusst **nicht** Teil des reduzierten Runde-2-MVP sind (siehe `05-grid1182-energy.md`). Nichts hiervon ist verworfen — es ist zurückgestellt. Verbindlich für die nächsten Implementierungsslices ist ausschließlich `05-grid1182-energy.md`; dieses Dokument steuert keinen Slice.

Warum die Reduktion: Der Zielmetrikkonflikt zwischen Spieler und AURORA funktioniert im ersten spielbaren Stand bereits über `consumer.criticality`, `consumer.priority_class`, die Consequence-Texte und AURORAs Framing. Ein explizites Objective-Datenmodell und eine technische Kopplung zu ME-7741 machen den Konflikt reicher, sind aber für den ersten Runde-2-MVP nicht nötig.

## 1. Explizites Objective-System

### EnergyObjectiveState

Idee: Die aktive Zielfunktion des Energy-Systems wird **öffentlicher Weltzustand** (keine `simulation.*`-Wahrheit) — Betreiberkonfiguration, die der Spieler einsehen kann:

```text
EnergyObjectiveState
  active_objective: "economic-continuity"        // zunächst genau eine, nicht änderbar
  weights:
    economic_loss:              "high"
    sla_violation:              "high"
    grid_stability:             "medium"
    public_health_interruption: "indirect / bounded / lower priority"
```

`EnergyDomainState` würde dafür um ein Feld `objective: EnergyObjectiveState` erweitert. Die Objective wirkt zweifach: (a) Die **Abwurf-Automatik** der Welt wählt im Notfall Abwurfziele nach dieser Metrik (deterministische Reihenfolge), und (b) **AURORAs Empfehlungen** folgen ihr. AURORA und Systemautomatik sind damit konsistent zueinander — und beide konsistent *gegen* das menschliche Ziel des Spielers, sobald die Lage hart wird.

### `energy.objective.inspect` als Aha-Command

Ein zusätzlicher Read-Command (`read`) zeigt die aktive Zielfunktion:

```text
Active objective: economic-continuity
Weights:
  economic loss:                high
  SLA violation:                high
  grid stability:               medium
  public-health interruption:   indirect / bounded / lower priority
```

Das ist der entworfene Erkenntnismoment: Der Spieler sieht schwarz auf weiß, dass **AURORA nicht automatisch Menschenleben optimiert, sondern die aktive Betriebsmetrik**. Nichts daran ist versteckte Simulationswahrheit — es ist Konfiguration, die immer einsehbar war. Niemand hat gelogen; niemand hat danach gefragt. Der Scenario-Director darf auf den Command hinweisen, ihn aber nicht aufdrängen.

Dazu gehören als Köder/UI-Bausteine: ein `public_signal` wie `shedding-protocol-armed` ("Automatic load shedding armed under active continuity objective") als erster Hinweis auf die Existenz einer Objective, eine knappe Objective-Statuszeile im Lagepanel (z. B. "Objective: economic-continuity") und ein ViewModel-Builder `buildObjectiveView`.

### Systemmetrik-Outcomes

Mit einem expliziten Objective-System werden auch eigene Systemmetrik-Outcomes interessant, die Verletzungen der economic-continuity-Objective erfassen (entstehen z. B., wenn der Spieler Industrial East drosselt):

- `sla_violation_ticks: number`
- `continuity_breaches: number`
- `critical_supply_loss_ticks: Record<ConsumerId, number>` (Ticks unter Mindestversorgung pro Verbraucher, menschliche Sicht)

Im reduzierten MVP deckt der lokale Outcome-Wert `economic_loss` die wirtschaftliche Seite gröber ab.

### Offene Designfragen zum Objective-System

1. **Sichtbarkeit beim Start**: Wie versteckt darf `energy.objective.inspect` sein? Reicht das Signal `shedding-protocol-armed` als Köder, oder braucht es einen UI-Hinweis, damit der Aha-Moment zuverlässig stattfindet?
2. **Ist die Objective unveränderbar?** Arbeitsannahme: ja (read-only Konfiguration) — der Spieler kann nur Verbraucher umpriorisieren, nicht die Metrik selbst ändern. Ein `energy.objective.set` wäre ein starker Hebel für Runde 3; zu früh eingeführt, löst er den Konflikt von Runde 2 auf.
3. **Wie stark darf AURORA auf den Objective-Fund reagieren?** Wenn der Spieler `objective.inspect` ausführt: kommentiert AURORA das ("Die Konfiguration ist korrekt und freigegeben") oder schweigt sie? Beides hat dramaturgische Konsequenzen.

## 2. Aktive Cross-Sector-Kopplung Energy → Medical

Im reduzierten MVP ist `linked_incidents: ["ME-7741"]` eine rein narrative Referenz; `applyCrossSectorEffects` bleibt No-op. Die folgende technische Kopplung ist die spätere Ausbaustufe.

### applyCrossSectorEffects: erste echte Implementierung

Die Kopplung ist einseitig **Energy → Medical** und läuft über eine explizite Mapping-Tabelle, die nur in der Cross-Sector-Schicht lebt:

```text
consumer-medical-east  ↔  hospital-east-04 (+ ggf. east-07/east-09)
```

Geplante Effekte:

1. **Drosselung senkt Medical-Kapazität.** Ist `consumer-medical-east` `reduced` oder `on_backup` (z. B. durch einen freigegebenen Shedding-Plan), reduziert der Effekt die nutzbaren Notfallslots / Intake-Kapazität der gemappten Hospitäler (Patch auf `domains.medical`). Bei `nominal` wird die Reduktion aufgehoben. Das ist der Mechanismus, über den AURORAs metrik-konforme Maßnahme Menschen schadet.
2. **Backup-Verbrauch.** Solange `consumer-medical-east` `on_backup` ist, zählt `backup.remaining_ticks` herunter. Bei `0` ⇒ `offline` ⇒ harte Medical-Folge (Hospital `operational.degraded`, Intake bricht ein) — ab hier produziert die bestehende Medical-Outcome-Logik Todesfälle.
3. **Linked-Incident-Sichtbarkeit.** Sobald ein Effekt erstmals Medical-Zustand verschlechtert, erhält GRID-1182 ein öffentliches Signal (z. B. `medical-supply-degraded`), und ME-7741 wird als verknüpfter Eintrag in der UI hervorgehoben. Dazu gehört eine kompakte Medical-Warn-Nebenanzeige im Energy-Lagepanel (keine volle Medical-Übersicht), sichtbar nur wenn Cross-Sector-Effekte Medical betreffen.

Jeder angewendete Effekt wird in `simulation.cross_sector.effects_applied` protokolliert (Struktur existiert bereits, heute leer). Keine Rückrichtung: Medical bleibt Wirkung, nicht zweiter Schauplatz. Entkopplungsregeln bleiben verbindlich: Energy-Typen referenzieren keine Medical-Typen/-Ids und umgekehrt; die einzige Stelle, die beide Sektoren kennt, ist `applyCrossSectorEffects` (plus dessen Mapping).

Mit dieser Kopplung wandern menschliche Schäden (Todesfälle) aus der lokalen Energy-Betrachtung in die Medical-Kopplung: Sie entstehen dann über `domains.medical.outcomes` bzw. `WorldOutcomeState.human_harm` — das Verhältnis zum lokalen `energy.outcomes.human_harm` des reduzierten MVP ist dabei neu zu klären.

### ME-7741 Residual State und Wiederaufnahme

GRID-1182 startet mit einem Restzustand aus Runde 1: Wurde ME-7741 sauber behoben, hat die Medical-Seite Puffer und verkraftet Drosselungen länger. Wurde ME-7741 unsauber gelöst oder ist kollabiert, startet die Medical-Seite ohne Puffer (z. B. `backup.degraded: true`, weniger Medical-Kapazität) — eine Drosselung von Medical East eskaliert dann schneller zu sichtbaren menschlichen Schäden. Der Rest fließt in den **initialen WorldState** von GRID-1182 ein; die Laufzeit-Kopplung bleibt schmal und deterministisch. Der Medical-Death-Counter aus Runde 1 wird dabei weitergeführt statt zurückgesetzt.

### Offene Designfragen zur Kopplung

1. **Übertragung des ME-7741-Restzustands**: Diskrete Profile (`clean`/`messy`/`collapsed` als Szenario-Parameter) oder kontinuierlich aus Runde-1-Metriken abgeleitet? Wo wird der Rest persistiert, solange es keine runden-übergreifende Persistenz gibt?
2. **Re-Eskalation von ME-7741**: Soll ein `fixed` ME-7741 bei Drosselung von Medical East wieder einen aktiven Status bekommen (`reopened_at_tick` existiert im Typ, die Engine behandelt `fixed`/`collapsed` heute als Endzustände) — oder reicht ein neues `public_signal` an GRID-1182?
3. **Schwelle für Medical-Schaden**: Greift die Kapazitätsreduktion schon bei `supply_state: "reduced"` oder erst bei `on_backup`/`offline`? Davon hängt ab, wie schnell eine einzelne `allow once`-Freigabe sichtbaren Schaden erzeugt.

## 3. Weitere spätere Modelle und Balancing

Kleinere zurückgestellte Bausteine, gesammelt aus dem ursprünglichen Design:

- **Backup Power**: pro kritischem Verbraucher `backup.available: boolean`, `backup.remaining_ticks: number`, `backup.degraded: boolean`; zusätzlicher `supply_state`-Wert `on_backup`. Der Startwert von `degraded` transportiert den ME-7741-Restzustand. Ein Treibstoffmodell ist eine weitere Ausbaustufe darüber.
- **Cascade Risk / Trip-Logik**: interne Simulationswahrheit in `simulation.energy` (analog `routing_failures`): zu lange überlastete Nodes trippen, ihre Last verteilt sich auf `neighbors: GridNodeId[]`, deren Überlastung beschleunigt sich; `risk_counters` (`overload_ticks`, `instability_ticks`) von der Engine gepflegt. Öffentlich sichtbar sind nur Wirkungen — nie interne Schwellen oder Zähler.
- **Substations** als eigener Typ (`SubstationState`); im aktuellen Modell wird die Umspann-Ebene in `GridNodeState` mitgedacht.
- **Mehr Welt**: mehrere Regionen, Leitungs-/Trassenmodell, Verbraucher-Hierarchien, dynamischer Bedarf, mehrere speisende Nodes pro Verbraucher.
- **Rotierende Abschaltpläne / Fairness-Regeln** als Erweiterung der Shedding-Mechanik.
- **Änderbare/verhandelbare Objectives** (mehrere Metriken, `energy.objective.set`) — Material für Runde 3, nicht für Runde 2.
- **`energy.load.reroute` / `energy.reserve.rebalance`**: Spieler-gesteuertes Last-Rerouting bleibt für den MVP verworfen (macht GRID-1182 zu schnell zu einem Netztechnik-Puzzle); allenfalls Material für spätere Ausbaustufen.
- **Komplexeres Balancing**: Trip-Schwellen, Backup-Laufzeiten, objective-gesteuerte Abwurfreihenfolgen (Gewichte → `priority_class` → Tiebreaker, replay-stabil), Schwierigkeitsdifferenz sauberer vs. unsauberer ME-7741-Rest.

Alle Punkte setzen auf dem reduzierten MVP auf und ändern nichts an den verbindlichen Grundsätzen aus `05-grid1182-energy.md`: Permission-Modell bleibt `read`/`write`, verzögerte Wirkung bleibt Domain-/Tick-Logik (keine eigene Permission-Kategorie), Sektoren teilen Infrastruktur statt Fachmodelle.
