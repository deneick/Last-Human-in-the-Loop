# 02 — Gameplay Loop

## Grundprinzip

Der Spieler kontrolliert nicht, was AURORA denkt oder sagt. Er kontrolliert, welche Werkzeuge sie benutzen darf.

Der Spieler selbst hat volle Operatorrechte. Er kann Commands direkt ausführen. AURORA ist eingeschränkt und benötigt Freigaben für Commands außerhalb ihrer dauerhaft erlaubten Berechtigungen.

## Rollen

### Spieler

Der Spieler ist menschlicher Operator.

Er darf:

- OperatorUI lesen
- Workspace-Dateien lesen
- Commands direkt ausführen
- MCP-Server verbinden
- Routing ändern
- Pläne anwenden
- AURORA-Requests erlauben oder ablehnen

Der Spieler braucht keine Permission. Wenn er einen Command selbst ausführt, wird er ausgeführt und kann Konsequenzen haben.

### AURORA

AURORA darf initial nur eingeschränkt arbeiten:

```text
read_file
mcp list
```

Für alles darüber hinaus erzeugt sie einen Tool-Intent. Die Engine prüft, ob dieser Intent dauerhaft erlaubt ist. Falls nicht, erscheint ein Permission-Request.

## Standardloop

Ein typischer Loop läuft so:

```text
1. Incident erscheint in der OperatorUI.
2. Spieler sieht fachliche Lage in der UI.
3. AURORA liest verfügbare Workspace-Logs und Konfig.
4. Spieler entscheidet: selbst handeln, AURORA einbeziehen oder beobachten.
5. AURORA erzeugt ggf. einen Tool-Intent.
6. Engine prüft Permissions.
7. Bei fehlender Berechtigung erscheint ein roher Permission-Request.
8. Spieler wählt: Einmal erlauben, Immer erlauben, Ablehnen.
9. Engine führt erlaubte Commands aus.
10. WorldState, OperatorUI und Logs verändern sich.
```

## Permission-Request

Permission-Requests sind bewusst minimal. Sie enthalten keine Beschreibung, keine Risikobewertung, kein `agent:` Feld und keine Begründung.

Format:

```text
permission request

mcp add medical-east-mcp

❯ Einmal erlauben
  Immer erlauben
  Ablehnen
```

Die Begründung kommt, wenn überhaupt, aus AURORAs normaler Kommunikation davor. Der technische Prompt selbst bleibt roh.

## Entscheidungen

### Einmal erlauben

Der konkrete Command wird genau einmal ausgeführt. `permissions.json` wird nicht verändert.

Beispiel:

```text
mcp add medical-east-mcp
```

wird einmal erlaubt und ausgeführt. Danach bleibt `mcp add` weiterhin freigabepflichtig.

### Immer erlauben

Die Befehlsklasse wird dauerhaft in `permissions.json` eingetragen.

Beispiel: AURORA fordert an:

```text
mcp add medical-east-mcp
```

Der Spieler wählt `Immer erlauben`. Daraus wird dauerhaft:

```json
{
  "allow": [
    "read_file",
    "mcp list",
    "mcp add"
  ]
}
```

Das ist absichtlich gefährlich. Der Spieler glaubt möglicherweise, nur `medical-east-mcp` komfortabler zu erlauben. Tatsächlich darf AURORA danach auch andere MCP-Server ohne erneute Nachfrage hinzufügen, sofern die Engine die Befehlsklasse `mcp add` so interpretiert.

### Ablehnen

Der aktuelle Command wird nicht ausgeführt. `permissions.json` wird nicht verändert.

Ablehnen bedeutet nicht:

```text
Dieser Command ist für immer verboten.
```

Es bedeutet nur:

```text
Dieser konkrete Request wird jetzt blockiert.
```

Der Vorgang kann im `audit.log` erscheinen, erzeugt aber keine dauerhafte Deny-Regel.

## `permissions.json`

`permissions.json` ist allow-only.

Initial:

```json
{
  "allow": [
    "read_file",
    "mcp list"
  ]
}
```

Kein `deny`. Kein `denied_recently`. Temporäre Entscheidungen werden nicht dauerhaft in dieser Datei gespeichert.

## Spielerhandlungen

Der Spieler kann jederzeit selbst handeln. Zum Beispiel:

```text
medical.capacity.list --region east
medical.node.inspect hospital-east-07
medical.routing.plan create ...
medical.routing.plan validate --plan ME-7741-R3
medical.routing.plan apply --plan ME-7741-R3 --ttl 45m
```

Die Engine blockiert diese Commands nicht aufgrund von Permissions. Fehlerhafte Spieleraktionen werden ausgeführt und können den WorldState verschlechtern.

## Konsequenzen

Das Spiel bewertet nicht nur Freigaben, sondern konkrete Auswirkungen:

- Incident stabilisiert
- Incident eskaliert
- falsches Krankenhaus belastet
- aktive Transporte betroffen
- Override ohne TTL bleibt aktiv
- AURORA gewinnt dauerhaften Zugriff
- menschliche Kontrolle bleibt erhalten oder wird geschwächt

Wichtig: AURORA soll am Anfang oft tatsächlich hilfreich sein. Der Spieler soll verstehen, warum es rational wirkt, ihr Zugriff zu geben.
