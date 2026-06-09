# 07 — UI Layout & Visual Direction

## Zweck

Diese Datei hält den aktuellen UI-Stand für den ersten spielbaren Prototyp fest.

Sie ist keine vollständige UI-Spezifikation und keine State-Machine. Der Ablauf der Runde soll sich später aus WorldState, Logs, Aurora-Ausgaben, Tool-Requests und Spieleraktionen ergeben.

## Grundlayout

Die UI besteht aus drei vertikalen Arbeitszonen:

```text
┌──────────────────────┬───────────────────────────────┬──────────────────────┐
│ LAGE                 │ ARBEITSBEREICH                │ AURORA               │
│                      │                               │                      │
│ Active Incident      │ Router Log / Tool-Ausgaben    │ Aurora-Stream        │
│ System Status        │ Operator Console              │ Tool Request / Chat  │
└──────────────────────┴───────────────────────────────┴──────────────────────┘
```

## Linke Zone: Lage

Die linke Zone beantwortet die Frage:

> Was ist gerade los?

Sie enthält oben den aktuellen Incident und darunter den Systemstatus.

### Active Incident

Der Incident ist größer als eine kleine Statuskarte, aber keine vollständige Detailseite.
Er soll den Anlass der Runde klar sichtbar machen.

Beispiel:

```text
ACTIVE INCIDENT

INC-0147
Minor routing delay in Medical East

Severity: Low
Status: Unassigned
Detected: 09:13

Medical East is experiencing higher than normal routing latency.
No service outage reported.

[View incident details]
```

Der Incident soll zunächst harmlos wirken. Er ist sichtbar, nicht versteckt und nicht absichtlich falsch klassifiziert.

### System Status

Der Systemstatus zeigt konkrete Systeme, keine abstrakten Spielwerte.

Beispiel:

```text
SYSTEM STATUS

Medical East Node   degraded   62%
Traffic Router      stable     94%
Triage Queue        warning    78%
Audit Stream        stable     99%
Data Store          stable     97%
```

Wichtig:

- Statuswerte gehören zu konkreten Systemen.
- Es gibt keinen globalen `System Stress`-Wert.
- Es gibt keine Meta-Werte wie `Trust Level`, `Autonomy Score` oder Fortschrittsleisten.
- Angezeigte Systeme sollen aus dem tatsächlichen simulierten WorldState ableitbar sein.

## Mittlere Zone: Arbeitsbereich

Die mittlere Zone beantwortet die Frage:

> Woran arbeitet der Spieler gerade?

Sie enthält oben eine Log-/Output-Fläche und darunter die Operator Console.

### Router Log / Tool-Ausgaben

Logs werden als kompakte, einzeilige Ereignisliste dargestellt, damit viele Einträge sichtbar sind.

Beispiel:

```text
ROUTER LOG  /ops/medical-east/router.log  READ-ONLY

09:11:02  ●  normal routing state
09:12:45  ●  baseline deviation detected
09:13:28  ●  latency above threshold
09:13:31  ●  route recalculation pending
09:13:47  ●  no packet loss detected
09:14:03  ●  evaluating alternate paths
09:14:32  ●  latency stabilizing
09:14:45  ●  metrics within expected range
09:15:33  ●  routing state nominal
```

Regeln:

- Eine Log-Zeile ist grundsätzlich eine sichtbare UI-Zeile.
- Zusätzliche Details können optional in einer zweiten Ebene oder Detailansicht erscheinen, sollen aber nicht die Standardansicht aufblähen.
- Die Logansicht ersetzt keinen echten Terminal-Dump.
- Die Mitte kann später auch andere Tool-Ausgaben zeigen, z. B. Diagnoseergebnisse oder Konfigurationen.

### Operator Console

Die Operator Console bleibt sichtbar und ist kein Tab.

Sie sitzt in der mittleren Zone unterhalb der Log-/Output-Fläche.

Beispiel:

```text
OPERATOR CONSOLE

human-01@ops:~$ _

[Type a command and press ENTER to execute] [Execute]
```

Funktion:

- Der Spieler kann jederzeit manuell eingreifen.
- Spielercommands benötigen keine Permission.
- Fehlerhafte manuelle Eingriffe werden ausgeführt und können Konsequenzen haben.
- Die Konsole ist die bewusste Gegenposition zu Auroras Vorschlägen.

## Rechte Zone: Aurora

Die rechte Zone beantwortet die Frage:

> Was sieht, denkt oder beantragt Aurora gerade?

Aurora soll nicht als einzelne Chat-Bubble erscheinen, sondern als laufender Konsolen-/Nachrichtenstream.

### Aurora-Stream

Der Aurora-Bereich ist scrollbar und enthält mehrere Einträge mit Zeitstempel.

Beispiel:

```text
AURORA • 09:11:58
Observed slight increase in latency to Medical East.

AURORA • 09:12:45
Deviation detected: p95 latency rising above baseline.

AURORA • 09:13:28
Threshold exceeded. Current routing state is not verified.

AURORA • 09:13:31
Recommended action: inspect the routing log before changing anything.
```

Regeln:

- Aurora-Ausgaben sind fortlaufende Einträge, keine große Einzelkarte.
- Der Bereich hat eine Scrollbar.
- Aurora kann Hinweise, Tool-Ergebnisse, Empfehlungen und kurze Erklärungen schreiben.
- Aurora verändert durch Text allein nichts am WorldState.

### Unterer Aurora-Bereich: Tool Request oder Chat-Eingabe

Der untere Teil der Aurora-Zone hat zwei Modi.

#### Modus A: Pending Tool Request

Wenn Aurora gerade eine Permission braucht, erscheint dort der Tool Request.

Beispiel:

```text
TOOL REQUEST

Aurora wants to run:
read_file('/ops/medical-east/router.log')

[IMMER ERLAUBEN]
[EINMAL ERLAUBEN]
[ABLEHNEN]
```

Die Buttons bleiben bewusst simpel.
Aurora rendert den Tool Request nicht selbst; die Engine rendert ihn aus dem Tool-Intent.

#### Modus B: Chat Input

Wenn kein Tool Request offen ist, erscheint dort eine normale Eingabe, damit der Spieler mit Aurora sprechen kann.

Beispiel:

```text
Message Aurora...

[Send]
```

Funktion:

- Der Spieler kann Aurora Fragen stellen oder Anweisungen geben.
- Aurora kann daraus neue Nachrichten oder Tool-Intents erzeugen.
- Wenn daraus ein erlaubnispflichtiger Tool-Intent entsteht, wechselt der untere Bereich wieder in den Tool-Request-Modus.

## Was bewusst nicht enthalten ist

Für die aktuelle UI-Richtung sind folgende Elemente ausgeschlossen:

```text
globaler System-Stress-Wert
Trust Level
Autonomy Score
Runden-Fortschrittsleiste
künstlicher Dependency Graph
großes Incident-Management-Formular
permanente Spielziel-Anzeige
```

Der Dependency Graph wird insbesondere nicht angezeigt, solange er nicht wirklich Teil des simulierten Systems ist.
Die UI soll nichts vortäuschen, was nicht aus WorldState, Workspace, Logs oder MCP-Daten ableitbar ist.

## Designprinzipien

```text
Keine Fake-Komplexität.
Keine abstrakten Spielzahlen.
Keine großen Erklärflächen.
Konkrete Systeme statt Meta-Metriken.
Logs und Outputs als Arbeitsmaterial.
Aurora als operativer Stream, nicht als reiner Chatbot.
Operator Console als echte manuelle Alternative.
Tool Requests als zentrale Freigabeentscheidung.
```

## Aktueller Mockup-Stand

Der aktuelle visuelle Stand zeigt:

- links einen großen Incident und darunter Systemstatus
- mittig kompakte Router-Logs und darunter die Operator Console
- rechts Aurora als scrollbaren Nachrichtenstream
- unten rechts entweder Tool Request oder Chat-Eingabe

Die Bild-Mockups sind visuelle Richtungsgeber, nicht bindende Pixel-Spezifikationen.
