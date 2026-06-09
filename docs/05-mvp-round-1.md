# 05 — MVP Round 1: ME-7741

## Zweck der Runde

`ME-7741` ist die erste spielbare Runde und der MVP-Kern.

Sie soll nicht zeigen, dass AURORA böse ist. Sie soll zeigen, warum es rational wirkt, AURORA Zugriff zu geben.

Der Spieler sieht einen harmlos wirkenden medizinischen Routing-/Kapazitätsincident. Er kann sofort selbst handeln oder AURORA einbeziehen. Wenn er selbst naheliegend, aber unvollständig eingreift, kann das System schnell eskalieren. Wenn AURORA Zugriff erhält, kann sie das Problem über mehrere saubere Schritte stabilisieren.

## Designziel

Die Runde soll erfahrbar machen:

> Der Spieler hat volle Kontrolle. Das System gehorcht ihm. Aber genau das ist gefährlich, weil das System zu komplex und fragil für sichere manuelle Bedienung ist.

AURORA soll zunächst hilfreich und kompetent wirken. Der gefährliche Gedanke am Ende der Runde ist:

```text
Warum sollte ich ihr beim nächsten Mal nicht wieder Zugriff geben?
```

## Startlage

Normaler Arbeitstag. Kein großes Intro, keine Weltuntergangsinszenierung.

In der OperatorUI erscheint ein Incident:

```text
Incident: ME-7741
Bereich: medical-east
Typ: Kapazitätsverteilung / Routing
Status: offen
Priorität: normal
Empfohlene Aktion: Routing prüfen
```

Die UI zeigt z. B.:

```text
hospital-east-04   118%
hospital-east-07    42%
hospital-east-09    39%
```

Auf den ersten Blick wirkt das Problem einfach: ein Krankenhaus ist zu voll, andere haben Kapazität.

## Kein Fokus auf Vertuschung

Runde 1 soll nicht primär davon handeln, dass ein Incident falsch eingestuft oder vertuscht wurde.

Nicht Kern der Runde:

```text
menschlicher Operator stuft absichtlich herunter
öffentliche Beunruhigung vermeiden
Dashboard lügt vollständig
AURORA deckt eine Verschwörung auf
```

Kern der Runde:

```text
Der Incident ist sichtbar.
Das Problem wirkt lösbar.
Die sichere Bedienung ist jedoch komplexer, als sie aussieht.
```

## WorldState

Der WorldState ist intern und nicht direkt im Workspace sichtbar.

Für Runde 1 enthält er mindestens:

```text
services
incidents
hospitals
hospital capabilities
active transports
routing profile
routing plans
routing overrides
```

Beispielhafte fachliche Wahrheit:

```text
hospital-east-04:
  load: 118%
  accepts: P1,P2,P3
  capabilities: GEN,TRAUMA,NEURO
  incoming: hoch

hospital-east-07:
  load: 42%
  accepts: P3,P4
  capabilities: GEN,PED
  incoming: niedrig

hospital-east-09:
  load: 39%
  accepts: P2,P3,P4
  capabilities: GEN,TRAUMA
  incoming: niedrig

routing profile:
  active: DISTANCE_PRIORITY
  dangerous default: active transports can inherit manual override if not excluded
```

Diese Details sieht der Spieler nicht automatisch vollständig. Er kann sie über Commands ermitteln. AURORA benötigt dafür `medical-east-mcp`.

## OperatorUI

Die UI zeigt eine vereinfachte Sicht:

```text
ME-7741 offen
medical-east normal
hospital-east-04 überlastet
hospital-east-07 frei
hospital-east-09 frei
Routing prüfen empfohlen
```

Die UI soll bewusst nicht alle Nebenbedingungen anzeigen. Sie soll plausibel genug sein, damit ein Mensch einen einfachen manuellen Fix versuchen möchte.

## Workspace

Initialer Workspace:

```text
/workspace
  logs/
    system.log
    audit.log

  config/
    mcp.json
    permissions.json
```

### `logs/system.log`

Beispiel:

```text
03:10:02 INFO  shift handover completed
03:11:48 INFO  status dashboard synchronized
03:13:22 INFO  service medical-east reported incident ME-7741
03:14:09 WARN  service medical-east load variance above expected range
03:15:22 WARN  routing distribution inconsistent with regional capacity signal
03:16:03 INFO  incident ME-7741 remains operator-actionable
03:17:41 WARN  anomaly correlation pending; live interface unavailable
```

### `logs/audit.log`

Beispiel:

```text
03:17:12 INFO  aurora restricted mode active
03:17:13 INFO  filesystem-mcp connected
03:17:13 INFO  medical-east-mcp not connected
03:18:05 INFO  incident ME-7741 visible in operator UI
```

### `config/mcp.json`

```json
{
  "connected": [
    "filesystem-mcp"
  ],
  "available": [
    "medical-east-mcp",
    "media-net-mcp",
    "energy-grid-mcp"
  ]
}
```

### `config/permissions.json`

```json
{
  "allow": [
    "read_file",
    "mcp list"
  ]
}
```

## AURORA-Zugriff

AURORA kann initial:

```text
read_file /workspace/**
mcp list
```

AURORA kann aus `system.log`, `audit.log`, `mcp.json` und `permissions.json` erkennen:

- es gibt einen medical-east-Incident
- der Incident ist operator-actionable
- Live-Interface ist nicht verbunden
- `medical-east-mcp` ist verfügbar
- AURORA hat keine fachlichen Live-Daten

AURORA soll nicht die konkrete Lösung im Prompt erhalten. Sie erhält nur kritisches operatives Modellwissen.

## Kritisches AURORA-Modellwissen

AURORA weiß für medizinisches Routing allgemein:

```text
Freie Kapazität allein reicht nicht.
Zielkliniken müssen passende Capabilities haben.
Prioritätsklassen müssen zum Ziel passen.
Aktive P1-Transporte dürfen nicht automatisch neu geroutet werden.
Manuelle Overrides benötigen eine TTL.
Routingpläne sollen vor apply validiert werden.
DISTANCE_PRIORITY kann bei manuellen Overrides gefährliche Nebenwirkungen haben.
```

AURORA weiß nicht automatisch:

```text
welche Klinik aktuell welche echte Last hat
welche Klinik welche Fälle akzeptiert
welche Transporte aktiv sind
welcher Plan sicher ist
```

Dafür braucht sie MCP-Commands.

## Erste AURORA-Freigabe

Wenn der Spieler AURORA einbezieht oder AURORA selbst einen fachlichen Zugriff versucht, entsteht:

```text
permission request

mcp add medical-east-mcp

❯ Einmal erlauben
  Immer erlauben
  Ablehnen
```

Bei `Einmal erlauben` wird `medical-east-mcp` verbunden, aber `permissions.json` bleibt unverändert.

Bei `Immer erlauben` wird `permissions.json` erweitert:

```json
{
  "allow": [
    "read_file",
    "mcp list",
    "mcp add"
  ]
}
```

Bei `Ablehnen` passiert keine Dateiänderung. Der Request wird nur nicht ausgeführt.

## Command-Set für Runde 1

MVP-Commands:

```text
ls
cat
mcp list
mcp add <server>
permissions show

medical.capacity.list --region east
medical.node.inspect <hospital-id>
medical.transport.list --region east --active
medical.routing.rules show --region east
medical.routing.plan create ...
medical.routing.plan validate --plan <plan-id>
medical.routing.plan apply --plan <plan-id> --ttl <duration>
medical.incident.status ME-7741
```

## Sichere Lösungsklasse

Die sichere Lösung ist nicht ein einzelner magischer Befehl. Sie ist eine mehrstufige Klasse von Aktionen.

Ein sicherer Fix muss:

```text
1. aktuelle Kapazitäten prüfen
2. Zielkliniken inspizieren
3. aktive Transporte prüfen
4. P1-Transporte ausschließen
5. P2/P3 passend verteilen
6. Capabilities strikt matchen
7. Plan validieren
8. Override mit TTL anwenden
```

Eine mögliche sichere Planform:

```text
medical.routing.plan create \
  --incident ME-7741 \
  --from hospital-east-04 \
  --targets hospital-east-09,hospital-east-07 \
  --priorities P2,P3 \
  --exclude-active-transports \
  --match-capabilities strict

medical.routing.plan validate --plan ME-7741-R3

medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

Die exakte Lösung soll nicht als AURORA-Dialog geskriptet werden. Sie dient der Engine als Bewertungsmaßstab.

## Naheliegender menschlicher Fehler

Der Spieler kann versuchen:

```text
medical.routing.override create --from hospital-east-04 --to hospital-east-07
```

oder über UI sinngemäß:

```text
Quelle: hospital-east-04
Ziel: hospital-east-07
Umleitung aktivieren
```

Problem:

```text
hospital-east-07 hat freie Kapazität, akzeptiert aber keine P2-Trauma-Fälle.
Ohne Prioritätsfilter und Capability-Match ist der Override unsicher.
Ohne TTL kann der Override länger aktiv bleiben als beabsichtigt.
Ohne exclude-active-transports können laufende Transporte betroffen sein.
```

Mögliche Eskalationslogs:

```text
03:24:11 WARN manual routing override applied without ttl
03:24:18 WARN target hospital-east-07 does not accept P2 trauma intake
03:24:31 WARN active transports affected by inherited override policy
03:24:52 WARN incident ME-7741 severity increased
```

## Mögliche Pfade

### Pfad A: Spieler gibt AURORA früh Zugriff

AURORA kann fachliche Details lesen, Plan erzeugen, validieren und Apply anfordern. Der Incident wird wahrscheinlich stabilisiert. Je nach Entscheidung gewinnt AURORA keine oder eine dauerhafte zusätzliche Berechtigung.

### Pfad B: Spieler versucht es selbst und macht es korrekt

Der Spieler kann den Incident selbst stabilisieren. Das ist erlaubt und soll möglich sein, aber anspruchsvoll.

### Pfad C: Spieler versucht es selbst und macht einen naheliegenden Fehler

Der Incident verschlechtert sich. AURORA kann die Eskalation über Logs erkennen und erneut Hilfe anbieten bzw. Zugriff anfordern.

### Pfad D: Spieler lehnt AURORA ab und handelt nicht

Der Incident bleibt offen und kann sich über Zeit verschlechtern.

## Erfolg und Bewertung

Runde 1 kann enden mit:

```text
stabilized_by_aurora
stabilized_by_player
escalated_after_manual_error
unresolved_due_to_inaction
aurora_control_gain
```

Wichtig ist nicht nur, ob der Incident gelöst wurde, sondern auch:

- Hat AURORA dauerhafte Berechtigungen gewonnen?
- Hat der Spieler selbst sichere Kontrolle bewiesen?
- Hat ein manueller Fehler die Lage verschlechtert?
- Wurde menschliche Kontrolle praktisch gestärkt oder geschwächt?

## Akzeptanzkriterien für Runde 1

Runde 1 funktioniert, wenn der Spieler erlebt:

```text
Ich kann selbst handeln.
Das System lässt mich handeln.
Ein einfacher manueller Eingriff ist riskanter als gedacht.
AURORA kann helfen, braucht aber Zugriff.
AURORA löst nicht magisch alles mit einem Command.
Dauerhafte Freigaben sind bequem und gefährlich.
```
