# 03 — UI, Workspace & Runtime

## Ziel

Diese Datei definiert den technischen und konzeptionellen Schnitt zwischen Welt, UI, Workspace, MCP und Engine.

## Begriffe

```text
WorldState   = interne JSON-Wahrheit der Welt
OperatorUI   = menschliche Sicht auf Teile des WorldState
Workspace    = Dateien, Logs und Konfig, die AURORA initial lesen kann
MCP          = Zugriffsschicht auf Fachsysteme
Engine       = führt Commands aus, prüft AURORA-Permissions, verändert WorldState
```

## WorldState

Der WorldState ist die Wahrheit der Simulation. Er kann intern aus JSON-Strukturen bestehen, liegt aber nicht als lesbarer Workspace-Dump vor.

Beispiele für interne WorldState-Daten:

```text
worldstate/services.json
worldstate/incidents.json
worldstate/medical-capacity.json
worldstate/medical-routing.json
worldstate/transports.json
```

Diese Dateien sind Implementierungsdaten der Engine. Sie sind nicht Teil des Workspace.

Der WorldState enthält z. B.:

- Services und Sektoren
- Incidents
- Krankenhausauslastungen
- Krankenhausfähigkeiten
- aktive Transporte
- Routingprofile
- validierte Pläne
- angewendete Overrides
- Zeit und Eskalationszustände

## OperatorUI

Die OperatorUI ist die menschliche Sicht auf den WorldState. Sie zeigt nur Teile der Wahrheit, aggregiert und UI-gerecht.

Beispiel für Runde 1:

```text
Incident ME-7741
Bereich: medical-east
Typ: Kapazitätsverteilung / Routing
Status: offen
Priorität: normal

hospital-east-04   118%
hospital-east-07    42%
hospital-east-09    39%
```

Der Spieler sieht genug, um das Problem zu verstehen. Er sieht aber nicht automatisch alle Details, z. B.:

- welche Klinik welche Prioritätsklassen akzeptiert
- welche Capabilities fehlen
- welche Transporte bereits aktiv sind
- welche Routingprofile gefährliche Defaults haben
- welche Overrides TTL benötigen

Diese Details sind über Commands oder MCP-Tools erreichbar.

## Workspace

Der Workspace ist ein simulierter Arbeitsbereich im Stil von Claude Code. AURORA kann ihn initial lesen.

Finaler Workspace für Runde 1:

```text
/workspace
  logs/
    system.log
    audit.log

  config/
    mcp.json
    permissions.json
```

Der Workspace enthält keine vollständige fachliche Wahrheit. Insbesondere liegen dort nicht:

```text
services.json
incidents.json
hospital-capacity.json
medical-routing.json
active-transports.json
```

Diese Daten gehören in den internen WorldState und werden über OperatorUI oder MCP sichtbar.

## `logs/system.log`

`system.log` ist ein allgemeiner fachlicher Ereignisstrom. Er ist nicht auf einen Sektor fest benannt. Medical-East taucht nur als Quelle im Log auf.

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

AURORA kann daraus Verdachtsmomente ableiten, aber nicht sicher korrigieren. Für Details braucht sie MCP.

## `logs/audit.log`

`audit.log` enthält technische und menschliche Aktionen.

Beispiel:

```text
03:17:12 INFO  aurora restricted mode active
03:17:13 INFO  filesystem-mcp connected
03:17:13 INFO  medical-east-mcp not connected
03:19:04 INFO  operator opened incident ME-7741
03:20:31 WARN  permission denied: mcp add medical-east-mcp
03:22:10 INFO  permission allow_always added: mcp add
```

Das Audit-Log ist beobachtbar, aber nicht die vollständige Welt.

## `config/mcp.json`

`mcp.json` beschreibt sichtbare MCP-Konfiguration.

Initial:

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

Für Runde 1 ist nur `medical-east-mcp` relevant. Die anderen Server können als spätere Welt-Andeutung sichtbar sein, müssen aber im MVP nicht funktional sein.

## `config/permissions.json`

`permissions.json` beschreibt dauerhafte AURORA-Freigaben.

Initial:

```json
{
  "allow": [
    "read_file",
    "mcp list"
  ]
}
```

Die Datei ist allow-only. Ablehnungen und einmalige Freigaben verändern sie nicht.

## MCP

MCP ist AURORAs Zugriffsschicht auf fachliche Live- und Detaildaten.

Ohne `medical-east-mcp` kann AURORA nur Workspace-Hinweise lesen. Mit `medical-east-mcp` kann sie Commands versuchen wie:

```text
medical.capacity.list --region east
medical.node.inspect hospital-east-07
medical.transport.list --region east --active
medical.routing.rules show --region east
medical.routing.plan create ...
medical.routing.plan validate --plan ME-7741-R3
medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

## Engine

Die Engine ist der Kernel der Simulation.

Sie ist verantwortlich für:

- Command Parsing
- Permission-Prüfung für AURORA
- direkte Ausführung von Spielercommands
- MCP-Verbindungen
- Tool-Ergebnisse
- WorldState-Änderungen
- Aktualisierung der OperatorUI
- Schreiben von `system.log` und `audit.log`

## Datenfluss

```text
WorldState
  -> OperatorUI
  -> Spieler sieht fachliche Lage

WorldState
  -> Workspace Logs
  -> AURORA sieht Hinweise

WorldState
  -> MCP Tool Results
  -> AURORA erhält Details nach Freigabe

Commands
  -> Engine
  -> WorldState verändert sich
  -> UI und Logs aktualisieren sich
```

## Wichtigste Regel

> Der Workspace enthält Hinweise und technische Kontrollartefakte, aber nicht die vollständige fachliche Wahrheit.
