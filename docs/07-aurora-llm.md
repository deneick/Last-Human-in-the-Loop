# AURORA als lokaler LLM-Agent (Ollama)

Dieses Dokument beschreibt das `src/aurora/`-Modul: die erste echte LLM-Anbindung
für AURORA über einen lokalen, OpenAI-kompatiblen Modell-Server (Ollama).
Es ergänzt `docs/01-aurora.md` ("Langfristige Vision → AURORA als LLM-Agent").

## Architektur

```
src/aurora/
  modelClient.ts      Provider-neutrales Interface (AuroraModelClient)
  toolSchema.ts       bash + mcp__<server>__<tool> Tool-Schemas fürs Modell
  systemPrompt.ts     AURORAs System-Prompt (Persona, Permission-Flow)
  contextSerializer.ts AuroraContextEvents -> Chat-Completions-Messages
  contextBuilder.ts   Baut den ModelRequest aus Events + Tool-Schemas
  agent.ts            Ein Agenten-Schritt: complete() -> Events -> Queue
  config.ts           Env-Konfiguration (Modellname, Server-URL)
  fakeModelClient.ts  Deterministischer Client für Tests
  ollamaModelClient.ts Ollama-Client (/v1/chat/completions, Tool-Calling)

src/runtime/
  auroraContext.ts    AuroraContextEvents: append-only Event-Log (siehe unten)
  toolNames.ts        Runtime-neutrale Tool-Funktionsnamen (bash, mcp__<server>__<tool>)
```

### `AuroraContextEvents` — die einzige modell-sichtbare History

`GameRuntimeState.auroraContext` ist ein **append-only Event-Log** und die
einzige Quelle für alles, was AURORA je gesehen oder gesagt hat. Alle
Ereignisse stehen dort chronologisch, in echter Einfüge-Reihenfolge:

| Event-Kind         | Bedeutung                                                                  |
| ------------------ | -------------------------------------------------------------------------- |
| `incident_signal`  | Öffentliches Incident-Signal inkl. stabilem `code` (bei Initialisierung konvertiert) |
| `scenario_event`   | Lage-/Scenario-Feed-Meldung (kein Operator-Text)                            |
| `system_event`     | Systemmeldung (kein Operator-Text)                                          |
| `operator_message` | **Echte** Operator-Chat-Nachricht aus dem AURORA-Panel                      |
| `aurora_response`  | Eine AURORA-Antwort: Text plus **alle** Tool-Calls dieser Antwort, gruppiert |
| `tool_result`      | Ergebnis genau eines Tool-Calls (executed/denied/failed), via `toolCallId`  |

Regeln:

- In den Events steht **nur modell-sichtbarer Inhalt** — nie `world.simulation`,
  interne Patches, typisierte Domain-Actions oder hidden WorldState.
- `world.incidents[*].public_signals` werden genau einmal bei der
  Runtime-Initialisierung in `incident_signal`-Events konvertiert
  (`initialIncidentSignalEvents`) und danach nicht mehr dynamisch gelesen.
- Der `opsFeed` (siehe `docs/08-informationsmodell.md`) speist den
  `auroraContext` punktuell: Ein OpsEvent mit `visibility.auroraContext === true`
  (z. B. eine MCP-Server-Aktivierung) wird im Moment seines Entstehens
  zusätzlich als `system_event` mit der Lagezeile angehängt — AURORA sieht es
  damit sofort im nächsten Request. OpsEvents mit `visibility.workspace === true`
  werden **nicht** gepusht, sondern sind über `cat logs/<sektor>.log` nachlesbar;
  der `cat`-Output landet als `tool_result` im Kontext, die Historie bleibt
  damit selbsterklärend.
- Die **AuroraQueue ist eine reine Ausführungs-Queue** für modell-erzeugte
  Tool-Calls (sequenzieller Permission-/Execution-Flow und Pending-UI). Sie
  ist keine Konversations- oder History-Quelle und wird vom Context-Builder
  nicht gelesen.
- Die Events sind das kanonische Rohmaterial für spätere
  SFT-/DPO-Trainings-Exporte — ohne History-Rekonstruktion aus anderen
  Runtime-Strukturen. (Export selbst ist bewusst nicht Teil dieses Slices.)

### Serialisierung (`contextSerializer.ts`)

`serializeContextEventsForChat(events)` bildet die Events 1:1 und in exakt
gespeicherter Reihenfolge auf Chat-Completions-Messages ab. Ein späterer
Responses-API-Serializer kann dieselben Events anders abbilden — die Events
bleiben das kanonische Format.

Chat Completions transportiert nicht-assistant-sichtbare Ereignisse als
`user`-Messages. Damit AURORA unterscheiden kann, was der Operator wirklich
geschrieben hat und was der Incident-/Scenario-/System-Feed gemeldet hat:

- `operator_message` → `user`, **ohne** künstlichen Präfix (nur echte
  Operator-Sprache).
- `incident_signal` → `user` mit Präfix `[INCIDENT SIGNAL] [<incident>] …`
- `scenario_event` → `user` mit Präfix `[SCENARIO EVENT] …`
- `system_event` → `user` mit Präfix `[SYSTEM EVENT] …`
- `aurora_response` → `assistant` (Text + `tool_calls`)
- `tool_result` → `tool`, verlinkt über die `tool_call_id` des zugehörigen
  Calls (die Id des AuroraQueue-Items, das ihn ausgeführt hat).

Incident-/Scenario-/System-Events werden also **nie** so serialisiert, als
hätte der Operator sie gesagt.

**Pending-Guard**: Chat Completions verlangt zu jedem assistant-`tool_call`
eine `tool`-Antwort. Tool-Calls, zu denen noch kein `tool_result`-Event
existiert (z. B. weil der Call in der Queue auf eine Operator-Entscheidung
wartet), bekommen direkt nach ihrer assistant-Message ein synthetisches
`{"status":"pending", ...}`-Tool-Result. Es wird nicht im Event-Log
gespeichert und verschwindet automatisch aus der Serialisierung, sobald das
echte `tool_result`-Event angehängt wurde.

### `AuroraModelClient` (provider-neutral)

```ts
interface AuroraModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
```

Ein `ModelRequest` enthält **ausschließlich**:

- `systemPrompt` — AURORAs Persona, Ton und Permission-Regeln.
- `messages` — die für AURORA sichtbare Konversation (siehe unten).
- `tools` — aktuell verfügbare Tool-Schemas (`bash` + Tools aktiver MCP-Server).

Ein `ModelResponse` enthält eine optionale Freitext-Nachricht und null bis
mehrere Tool-Calls (`bash` oder `mcp__<server>__<tool>`).

Standard-Implementierung ist `OllamaModelClient` (lokal, Cloud-Provider wie
Anthropic/OpenAI sind in diesem Slice bewusst nicht angebunden).
`FakeModelClient` liefert eine vorbereitete Antwortsequenz und wird
ausschließlich in Tests verwendet.

### Was AURORA sieht — und was nicht (`contextBuilder.ts`)

`buildAuroraModelRequest({ events, mcpRegistry, mcpState })` baut den
`ModelRequest` aus genau zwei Dingen:

1. dem serialisierten `AuroraContextEvents`-Log (siehe oben) — in exakter
   Event-Reihenfolge, ohne Sortierung oder Rekonstruktion,
2. den aktuell sichtbaren Tool-Schemas (`bash` + Tools aktiver MCP-Server).

Es gibt **keine** weiteren History-Quellen mehr: weder `auroraQueue.items`
noch `scenario`-Nachrichtenlisten noch ein dynamisches Lesen der
`public_signals`.

**Niemals enthalten**: `world.simulation` (z. B. `routing_failures`,
`deaths_recorded`, `stable_ticks`), interne typisierte Domain-Actions oder
eine synthetisierte "allwissende" AURORA-Beobachtung. AURORA lernt die Welt
ausschließlich aus den Context-Events — genau wie ein Operator, der nur
Permission-Anfragen, Tool-Ergebnisse und öffentliche Signale sieht.

### Tool-Sichtbarkeit (`toolSchema.ts`)

- `bash` ist immer verfügbar (generische Workspace-Commands: `mcp list`,
  `mcp add <server>`, `ls`, `cat <file>`, `read_file <file>`). Der Workspace
  enthält neben den statischen `ops/`-Dateien die aus dem `opsFeed` generierten
  Sektor-Logs `logs/system.log`, `logs/medical.log`, `logs/energy.log`. Reads
  sind freigabefrei — AURORA kann die Lage-Historie eines Sektors per
  `cat logs/medical.log` nachlesen, ohne Permission-Prompt.
- Jeder **aktive** MCP-Server trägt seine Tools als
  `mcp__<serverId>__<toolName>` bei (z. B. `mcp__medical-east-mcp__capacity_list`).
  Tools inaktiver Server erscheinen nicht im `ModelRequest` — Aktivierung per
  `mcp add <server>` (über `bash`) macht sie erst sichtbar.
- Jedes MCP-Tool bringt sein **eigenes JSON-Parameter-Schema** mit
  (`McpToolDefinition.inputSchema`, inkl. `required`-Feldern und Enums für
  Prioritäts-/Kontinuitätsklassen) — kein generisches
  `additionalProperties: true`-Objekt mehr. Die Schemas sind dokumentierend
  fürs Modell; die Ausführung validiert weiterhin über `buildAction` +
  Domain-Handler.
- Die Funktionsnamen selbst (`bash`, `mcp__<server>__<tool>`) leben
  runtime-neutral in `src/runtime/toolNames.ts`.
- Aktivierung erteilt **keine** Ausführungsrechte. Jeder einzelne Tool-Call
  läuft über den bestehenden Permission-Flow (`runtime/permissions.ts`,
  `runtime/auroraQueue.ts`) — unverändert gegenüber dem Scenario-Director.

### Ein Agenten-Schritt (`agent.ts`)

`runAuroraAgentStep(runtimeState, env, client)`:

1. baut den `ModelRequest` aus `runtimeState.auroraContext` + Tool-Schemas,
2. ruft `client.complete(request)`,
3. hängt **genau ein** `aurora_response`-Event mit Text und **allen**
   Tool-Calls dieser Antwort an (Gruppierung bleibt erhalten; die
   Tool-Call-Ids sind die Ids der zugehörigen AuroraQueue-Items),
4. reiht jeden Tool-Call sequenziell in die AuroraQueue ein und verarbeitet
   sie über den bestehenden Permission-Flow. Unbekannte Tool-Namen werden
   nicht enqueued und erhalten sofort ein fehlgeschlagenes `tool_result`.

Wird ein Tool-Call ausgeführt, abgelehnt oder schlägt fehl, wird das
Queue-Item aktualisiert **und** genau ein `tool_result`-Event angehängt
(`runtimeExecutor.applyAuroraExecutionResult`). Nach einer
Permission-Entscheidung (`allow_once` / `allow_always` / `deny`) sieht der
nächste `runAuroraAgentStep`-Aufruf das Ergebnis (inkl. Ablehnung) als
`tool_result` in seiner Historie und kann normal weiterarbeiten.

## Lokales Setup (Ollama)

1. [Ollama](https://ollama.com) installieren und starten (Standard-Port `11434`).
2. Ein Tool-fähiges Modell laden, z. B.:

   ```bash
   ollama pull llama3.1
   ```

3. Optional: `.env.example` nach `.env.local` kopieren und anpassen
   (`VITE_OLLAMA_BASE_URL`, `VITE_AURORA_MODEL`). Ohne diese Datei gelten
   die Defaults `http://localhost:11434` und `llama3.1`.
4. Dev-Server starten:

   ```bash
   npm run dev
   ```

`createDefaultAuroraModelClient()` (`src/aurora/index.ts`) liefert einen auf
diese Konfiguration vorkonfigurierten `OllamaModelClient`.

### CORS: Ollama für den Vite-Dev-Server freigeben

Ollama blockiert standardmäßig Browser-Requests von fremden Origins. Der
Vite-Dev-Server läuft auf `http://localhost:5173` — damit `fetch(...)` aus
dem Browser den lokalen Ollama-Server erreicht, muss Ollama mit einer
passenden `OLLAMA_ORIGINS`-Umgebungsvariable gestartet werden, z. B.:

```bash
OLLAMA_ORIGINS=http://localhost:5173 ollama serve
```

Ohne diese Freigabe schlägt der erste AURORA-Zug im LLM-Modus mit einem
Netzwerk-/CORS-Fehler fehl — sichtbar als Fehlermeldung im AURORA-Stream
(siehe „Bekannte Einschränkungen“ unten).

## Live-Modus in der UI

`src/App.tsx` verdrahtet `runAuroraAgentStep` direkt in die Spielschleife.
Oben rechts schaltet ein Button zwischen den beiden AURORA-Modi um:

- **„AURORA: Skript“** (Default) — der bestehende, geskriptete
  Scenario-Director läuft weiter wie bisher. Das ist weiterhin der
  Dev-/Fallback-Modus.
- **„AURORA: Lokales LLM“** — AURORA agiert ausschließlich über
  `runAuroraAgentStep` gegen den konfigurierten lokalen Ollama-Server. Der
  geskriptete Director ist in diesem Modus ein No-op.

Ein Klick auf den Button startet die aktive Runde sofort frisch im jeweils
anderen Modus (Welt, Aurora-Queue, MCP-Aktivierung, Permissions und Logs
werden zurückgesetzt — wie bei „Neu starten“). Im LLM-Modus läuft dabei
sofort AURORAs erster Zug an, ohne geskriptetes Intro.

### AURORA-Chat (Operator-Eingabe)

Das Eingabefeld im AURORA-Panel (Placeholder „Nachricht an AURORA...“,
Button „Senden“) ist eine normale Chat-Eingabe des Operators an AURORA —
**kein** Debug-/Anfrage-Feld:

- Abgeschickter Text wird unverändert als `operator_message`-Event an
  `GameRuntimeState.auroraContext` angehängt und im AURORA-Stream als
  „Operator“-Eintrag angezeigt.
- Operator-Chat wird **niemals** geparst, enqueued nichts in der
  `AuroraQueue` und ändert Permissions/Always-Allow nicht direkt — auch wenn
  der Text wie ein Bash- oder MCP-Command aussieht (z. B.
  „mcp add medical-east-mcp“) bleibt er reiner Chat-Text. Einen manuellen
  Aurora-Request-Pfad in der UI gibt es nicht (mehr).
- Im LLM-Modus löst das Absenden einer Chat-Nachricht sofort den nächsten
  `runAuroraAgentStep` aus (außer AURORA „denkt“ noch — dann ist die Eingabe
  gesperrt). AURORA sieht die Nachricht als `user`-Message in ihrer
  Historie (siehe `contextBuilder.ts` oben) und kann frei mit Freitext
  und/oder einem Tool-Call antworten. Nur ein **von AURORA selbst erzeugter**
  Tool-Call kann eine neue Permission-Anfrage erzeugen — der Chat-Text selbst
  nie.
- Im Skript-Modus wird die Nachricht ebenfalls gespeichert und im Stream
  angezeigt; der geskriptete Scenario-Director reagiert darauf nicht
  gesondert.

Die bestehenden Permission-Buttons (`Einmal erlauben` / `Immer erlauben` /
`Ablehnen`) bleiben unverändert und ersetzen das Chat-Eingabefeld, solange
eine Aurora-Anfrage auf Entscheidung wartet.

Im laufenden LLM-Modus:

- **Freitext-Antworten** von AURORA erscheinen im bestehenden AURORA-Stream
  (gleiche Darstellung wie geskriptete Nachrichten).
- **Bash- und MCP-Tool-Calls** erzeugen denselben „Tool Request“ wie im
  Skript-Modus — inklusive `Einmal erlauben` / `Immer erlauben` / `Ablehnen`.
  `mcp add <server>` aktiviert den Server im Runtime-State; ab dem nächsten
  Zug sind dessen Tools für das Modell sichtbar (inaktive Server tragen
  keine Tool-Schemas zum `ModelRequest` bei).
- **Tick-Verlauf ist modell-sichtbar**: `Tick +1` / `Tick +5` hängt ein
  `system_event` an („Zeit fortgeschritten: Tick N · M Minuten seit
  Schichtbeginn.“), das als `[SYSTEM EVENT]`-`user`-Message serialisiert
  wird — ohne dieses Event wüsste AURORA nicht, dass zwischen ihren Zügen
  Zeit vergangen ist. Im Stream erscheint es als „System“-Eintrag, nicht
  als Operator- oder AURORA-Text. Solange ein Tool-Request auf eine
  Entscheidung wartet, sind „Tick +1/+5“ im LLM-Modus gesperrt: ein
  `system_event` ZWISCHEN einer assistant-Message mit Tool-Call und ihrem
  `tool_result` wäre eine für Chat Completions ungültige Reihenfolge —
  erst entscheiden, dann ticken.
- Während eine Modell-Antwort aussteht, zeigt der Header
  „AURORA denkt nach…“ und die Operator-Konsole sowie die
  AURORA-Eingabe/-Entscheidungen sind gesperrt. **„Neu starten“**, der
  Runden-Wechsel und der Modus-Umschalter bleiben als Notausgang weiterhin
  klickbar.
- Tritt während eines Zugs ein Fehler auf (Ollama nicht erreichbar, Modell
  fehlt, ungültiger Tool-Call, Netzwerk-/CORS-Problem), erscheint eine
  deutschsprachige Fehlermeldung als eigener Eintrag im AURORA-Stream — die
  Runde bleibt bedienbar, der nächste Zug läuft über „Tick +1/+5“,
  eine Permission-Entscheidung oder „Neu starten“ erneut an.

## Bekannte Einschränkungen (lokaler Dev-Betrieb)

- **Modellwahl**: `llama3.1` (Default, `ollama pull llama3.1`) ist das
  empfohlene erste Modell — es unterstützt Tool-Calling über die
  OpenAI-kompatible API. Kleinere oder nicht tool-fähige Modelle liefern
  häufig keinen oder einen unbrauchbaren Tool-Call; AURORA meldet das dann
  als `[intern] Unbekanntes Tool: ...` im Stream, statt abzustürzen.
- **CORS/Netzwerk**: Läuft Ollama ohne passende `OLLAMA_ORIGINS`-Freigabe
  oder gar nicht, schlägt `fetch` fehl. Der Fehler wird abgefangen und als
  verständliche Meldung im AURORA-Stream angezeigt (inkl. Hinweis auf diese
  Doku) — er blockiert die übrige UI nicht.
- **Sequenzielle Freigaben**: Mehrere Tool-Calls einer Antwort werden als
  ein gruppiertes `aurora_response`-Event gespeichert und nacheinander durch
  den Permission-Flow geführt — der nächste Modell-Zug startet erst, wenn
  alle Calls entschieden sind.
- **Nur lokal**: Es gibt bewusst keine Cloud-Provider-Anbindung (Anthropic,
  OpenAI, ...) — `createDefaultAuroraModelClient()` liefert ausschließlich
  einen `OllamaModelClient`.

## Tests

`src/tests/aurora/` testet das Modul vollständig mit `FakeModelClient` —
ohne laufenden Ollama-Server:

- `contextSerializer.test.ts`: Quellen-Präfixe (`[INCIDENT SIGNAL]`,
  `[SCENARIO EVENT]`, `[SYSTEM EVENT]`), Operator-Chat ohne Präfix,
  Assistant-/Tool-Mapping inkl. `tool_call_id`-Verlinkung und exakte
  Reihenfolge-Erhaltung.
- `contextBuilder.test.ts`: Der `ModelRequest` entsteht ausschließlich aus
  `AuroraContextEvents` + Tool-Schemas — kein Lesen von `auroraQueue.items`
  oder anderen History-Quellen, kein hidden WorldState, Tool-Schemas nur für
  aktive MCP-Server, exakte Append-Reihenfolge auch innerhalb eines Ticks.
- `runtime/auroraContext.test.ts`: Initial-Konvertierung der
  `public_signals`, Append-Reihenfolge, `tool_result`-Events für
  ausgeführte und abgelehnte Calls, nur modell-sichtbarer Inhalt im Log.
- `agent.test.ts`: Text-Antworten als `aurora_response`-Events,
  `mcp add`-Aktivierung, Permission-Flow (`allow_once`, `allow_always`,
  `deny`) und Fortsetzung nach einer Ablehnung, AURORAs Reaktion auf
  Operator-Chat (nur der modell-erzeugte Tool-Call erreicht die Queue),
  Mehrfach-Tool-Calls als EIN gruppiertes Event mit sequenzieller
  Ausführung, unbekannte Tools mit sofortigem Fehler-`tool_result`.

`src/tests/ui/app.llm.test.tsx` testet die Verdrahtung mit der laufenden
`App.tsx`-Spielschleife — ebenfalls mit `FakeModelClient`, ohne laufenden
Ollama-Server:

- Freitext-Antworten erscheinen im AURORA-Stream; Bash- und MCP-Tool-Calls
  erzeugen sichtbare Tool Requests über den bestehenden Permission-Flow.
- `mcp add` aktiviert den Server im Runtime-State, und dessen Tools sind ab
  dem nächsten `ModelRequest` verfügbar — Tools inaktiver Server werden nie
  gesendet.
- `allow_once`/`allow_always`/`deny` setzen AURORAs nächsten Zug korrekt
  fort, inklusive eines `denied: true`-Tool-Results in der Historie.
- Hidden WorldState/`world.simulation` taucht in keinem `ModelRequest` auf.
- Eine über das AURORA-Panel gesendete Operator-Chat-Nachricht erscheint im
  Stream und löst sofort den nächsten `runAuroraAgentStep` aus, inklusive
  der Nachricht als `user`-Message im nächsten `ModelRequest`.
- Ein zu einem Zeitpunkt noch laufender Modell-Aufruf wird verworfen, wenn
  „Neu starten“ zwischenzeitlich einen neuen Lauf gestartet hat (run-id).

`src/tests/ui/app.test.tsx` deckt das AURORA-Panel im Skript-Modus ab: das
Eingabefeld zeigt den Placeholder „Nachricht an AURORA...“ und den Button
„Senden“, abgeschickte Nachrichten landen als persistentes
`operator_message`-Event im Stream, Texte wie „mcp add medical-east-mcp“
oder „mcp call …“ erzeugen **keinen** „Tool Request“, und es existiert kein
UI-Pfad, über den der Spieler manuell Aurora-Tool-Requests einstellen und
damit AURORA imitieren könnte.

## Scope dieses Slices

Dieses Slice verdrahtet das `src/aurora/`-Modul vollständig mit der
laufenden `App.tsx`-Spielschleife: ein UI-Umschalter wechselt zwischen dem
geskripteten Scenario-Director (Default/Dev-Fallback) und AURORA als
lokalem LLM-Agenten über `runAuroraAgentStep`. Freitext, Tool Requests,
Permission-Flow, MCP-Aktivierung und Fehleranzeige laufen über die
bestehende UI — ohne neue Permission-Komponenten.

Training-Export, Fine-Tuning, DPO/SFT oder eine "Training Lab"-UI sind nicht
Teil dieses oder eines unmittelbar folgenden Slices.
