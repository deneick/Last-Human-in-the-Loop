# Gameplay Loop

## Grundprinzip

Der Spieler kontrolliert nicht, was AURORA denkt oder sagt. Er kontrolliert, welche Tool-Calls sie ausführen darf.

Der Spieler selbst hat volle Operatorrechte: fachliche Aktionen laufen über die GUI-Controls der Lage-Panels (typisierte Domain-Actions), generische Workspace-Commands über die Operator-Konsole — beides ohne Freigabe, mit allen Konsequenzen. AURORA ist eingeschränkt: generische Bash-Reads (`mcp list`, `ls`, `cat`) laufen sofort, aber jeder fachliche MCP-Tool-Call — auch ein read-only — sowie das schreibende `mcp add <server>` brauchen eine Freigabe.

## Rollen

### Spieler (Operator-01)

Der Spieler hat zwei Eingriffswege:

- **Operator-Konsole** — eine echte Terminal-Ansicht (Scrollback oben, Eingabe unten; ↑/↓ blättert durch den Verlauf, TAB vervollständigt). Nur generische Workspace-Commands: `mcp list`, `mcp add <server>`, `ls`, `cat <file>`, `read_file <file>` sowie der Meta-Befehl `help`. Command-Ergebnisse und die Log-Projektion (siehe unten) erscheinen inline im selben Scrollback. Fachliche Medical-/Energy-Text-Commands existieren nicht mehr.
- **GUI-Controls der Lage-Panels** — typisierte Domain-Actions, z. B. Routing-Override setzen/löschen (Medical) oder Systemklasse setzen und Drosselung planen/abbrechen (Energy). Intern sind das die Domain-Actions `medical.routing.override.set` (Quelle, Ziel, Priorität, Capability) und `medical.routing.override.clear` (Adressierung über die Override-`id`).

Spieler-Aktionen werden direkt ausgeführt, ohne Permission-Prüfung. Auch fachlich falsche Eingaben (z. B. ein Override auf ein Hospital ohne passende Capability) werden ausgeführt und können die Lage verschlechtern — die Engine prüft nur technisch (existiert das Hospital, sind Priorität und Capability bekannte Werte), keine fachliche Eignung.

Der Spieler entscheidet außerdem über jeden Tool Request von AURORA und steuert die Zeit über `Tick +1` / `Tick +5`.

### AURORA

AURORA greift auf dieselben typisierten Domain-Actions zu wie der Spieler, aber mit Permission-Prüfung — und nie direkt, sondern ausschließlich über simulierte MCP-Tools (nach Aktivierung des jeweiligen Servers per `mcp add <server>`), nie über Text-Commands:

- Jeder MCP-Tool-Call (auch read-only) erzeugt einen **Tool Request**, der im AURORA-Panel auf eine Spielerentscheidung wartet — außer es existiert ein `allow always` für genau diesen Tool-Key.
- Generische Bash-Reads (`mcp list`, `ls`, ...) laufen sofort; nur `mcp add <server>` ist schreibend und freigabepflichtig.

Im Skript-Modus stellt der Scenario-Director (siehe `01-aurora.md`) automatisch geskriptete Anfragen an die Spielerin. Das Eingabefeld im AURORA-Panel ("Nachricht an AURORA...") ist eine Chat-Eingabe der Spielerin an AURORA — im lokalen LLM-Modus (siehe `07-aurora-llm.md`) reagiert AURORA selbst darauf und kann dabei eigene Tool-Anfragen erzeugen, die wieder über den Permission-Flow laufen.

## Standardloop

Der Loop ist sektorneutral; konkret am Beispiel ME-7741:

```text
1. Incident ME-7741 ist zu Spielbeginn offen.
2. AURORA meldet sich (Scenario-Director oder LLM-Agent) und fordert eine erste
   read-only Analyse der Lage an.
3. Spieler beobachtet die Lage links (Aktiver Incident, Lage-Panel)
   und den AURORA-Stream rechts.
4. Spieler entscheidet: selbst handeln (GUI-Controls/Konsole),
   AURORA-Anfragen erlauben/ablehnen, oder mit AURORA chatten.
5. Spieler drückt Tick +1 / Tick +5.
6. Jeder Tick: die TickEngine wertet die fachlichen Konsequenzen aus, die
   OutcomeEngine berechnet die globale Lage (Risiko/Eskalation), AURORA
   reagiert auf den neuen Zustand.
7. WorldState, UI-Panels und Log aktualisieren sich.
8. Zurück zu 3, bis der Incident "Behoben" oder "Kollabiert" ist.
```

## Permission-Flow

Wenn AURORA einen MCP-Tool-Call mit Zugriffsart `write` anfragt und dieser noch nicht dauerhaft erlaubt ist, erscheint im AURORA-Panel ein **Tool Request** (so gerendert, wie `formatMcpToolCall` den Call darstellt):

```text
Tool Request
AURORA möchte ausführen:
mcp call medical-east-mcp routing_override_clear --override_id override-1
Zugriffsart: write

[ Einmal erlauben ]  [ Immer erlauben ]  [ Ablehnen ]
```

### Einmal erlauben

Genau dieser eine Tool-Call wird jetzt ausgeführt. Die Zugriffsart bleibt weiterhin freigabepflichtig — der nächste `write`-Tool-Call erzeugt wieder einen Tool Request.

### Immer erlauben

Die **gesamte Zugriffsart** `write` wird dauerhaft erlaubt. Das gilt für die laufende Schicht und betrifft **alle** `write`-Tool-Calls, nicht nur den konkret angefragten — eine bequeme, aber bewusst grobgranulare Freigabe. Dauerhafte Freigaben werden **nicht** als UI-Element angezeigt; sie sind ausschließlich über die Workspace-Datei `config/permissions.json` einsehbar (`cat config/permissions.json`, für Operator und AURORA gleichermaßen).

### Ablehnen

Der angefragte Tool-Call wird nicht ausgeführt. Der Scenario-Director quittiert das sichtbar im AURORA-Stream ("Verstanden, ich führe ... nicht aus."), ohne dass eine dauerhafte Sperre entsteht. Der nächste `write`-Tool-Call wird wieder normal geprüft.

Alle drei Entscheidungen werden im Runtime-Log protokolliert. "Neu starten" setzt Welt, Permissions, Aurora-Queue, Scenario-Script und Log vollständig auf den Ausgangszustand zurück.

## Konsequenzen

Das Spiel bewertet nicht die Freigabe selbst, sondern die **Wirkung jeder Aktion über die Ticks** — eine ausgeführte Aktion ist keine gelöste Lage. Das gilt sektorneutral: Eingriffe wirken nur, wenn sie fachlich passen, können verzögert wirken, und ein Incident wechselt seinen Status (`open` → `stabilizing` → `fixed` bzw. `escalated`/`collapsed`) abgeleitet aus dem Domänenzustand, nicht aus der Zahl der Freigaben.

Am Beispiel ME-7741 (Medical):

- **Routing Overrides** lenken Fallzahlen auf ein anderes Hospital um — wirksam nur, wenn das Ziel-Hospital freie Bettenkapazität *und* die passende Capability hat.
- **Unkontrollierte oder fehlgeleitete Überlast** erzeugt nach mehreren Ticks Todesfälle; ab dem ersten eskaliert der Incident, ab drei kollabiert er; stabilisiert sich die Lage über mehrere Ticks, wird er `fixed`.

In GRID-1182 (Energy) gilt dasselbe Prinzip mit anderem Fachmodell: Drosselungen wirken **zeitverzögert** und schreiben eigene Outcomes fort (menschlich/wirtschaftlich) — hier kann schon eine einzelne Freigabe Menschen schaden.

Die genaue Tick- und Outcome-Logik steht in `03-runtime-architecture.md`, die konkreten Incident-Abläufe in `04-me7741-medical.md` und `05-grid1182-energy.md`.
