# AURORA als lokaler LLM-Agent (Ollama)

Dieses Dokument beschreibt das `src/aurora/`-Modul: die erste echte LLM-Anbindung
für AURORA über einen lokalen, OpenAI-kompatiblen Modell-Server (Ollama).
Es ergänzt `docs/01-aurora.md` ("Langfristige Vision → AURORA als LLM-Agent").

## Architektur

```
src/aurora/
  modelClient.ts     Provider-neutrales Interface (AuroraModelClient)
  toolSchema.ts       bash + mcp__<server>__<tool> Tool-Schemas fürs Modell
  systemPrompt.ts     AURORAs System-Prompt (Persona, Permission-Flow)
  contextBuilder.ts   Baut den ModelRequest aus dem sichtbaren Runtime-State
  agent.ts            Ein Agenten-Schritt: complete() -> Queue -> Permission-Flow
  config.ts           Env-Konfiguration (Modellname, Server-URL)
  fakeModelClient.ts  Deterministischer Client für Tests
  ollamaModelClient.ts Ollama-Client (/v1/chat/completions, Tool-Calling)
```

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

Ein `ModelResponse` enthält eine optionale Freitext-Nachricht und höchstens
einen Tool-Call (`bash` oder `mcp__<server>__<tool>`).

Standard-Implementierung ist `OllamaModelClient` (lokal, Cloud-Provider wie
Anthropic/OpenAI sind in diesem Slice bewusst nicht angebunden).
`FakeModelClient` liefert eine vorbereitete Antwortsequenz und wird
ausschließlich in Tests verwendet.

### Was AURORA sieht — und was nicht (`contextBuilder.ts`)

`buildAuroraModelRequest(...)` rekonstruiert die sichtbare Historie aus:

1. öffentlichen Incident-Signalen (`world.incidents[*].public_signals`),
2. skriptierten Operator-/Lage-Nachrichten (`scenario.messages`),
3. Operator-Chat aus dem AURORA-Panel (`scenario.operatorMessages`) — die
   normale Spieler-Kommunikation an AURORA, als `user`-Nachrichten,
4. bereits bearbeiteten Aurora-Anfragen — als Tool-Call + Tool-Result-Paar,
   ohne den internen WorldState-Patch,
5. AURORAs eigenen vorherigen Freitext-Antworten (`scenario.agentMessages`).

Alle Quellen werden nach `(tick, sequence)` sortiert zu einer einzigen
chronologischen `messages`-Liste zusammengeführt.

**Niemals enthalten**: `world.simulation` (z. B. `routing_failures`,
`deaths_recorded`, `stable_ticks`), interne typisierte Domain-Actions oder
eine synthetisierte "allwissende" AURORA-Beobachtung. AURORA lernt die Welt
ausschließlich aus dem, was oben aufgelistet ist — genau wie ein Operator,
der nur Permission-Anfragen, Tool-Ergebnisse und öffentliche Signale sieht.

### Tool-Sichtbarkeit (`toolSchema.ts`)

- `bash` ist immer verfügbar (generische Workspace-Commands: `mcp list`,
  `mcp add <server>`, `ls`, `cat <file>`, `read_file <file>`).
- Jeder **aktive** MCP-Server trägt seine Tools als
  `mcp__<serverId>__<toolName>` bei (z. B. `mcp__medical-east-mcp__capacity_list`).
  Tools inaktiver Server erscheinen nicht im `ModelRequest` — Aktivierung per
  `mcp add <server>` (über `bash`) macht sie erst sichtbar.
- Aktivierung erteilt **keine** Ausführungsrechte. Jeder einzelne Tool-Call
  läuft über den bestehenden Permission-Flow (`runtime/permissions.ts`,
  `runtime/auroraQueue.ts`) — unverändert gegenüber dem Scenario-Director.

### Ein Agenten-Schritt (`agent.ts`)

`runAuroraAgentStep(runtimeState, env, client)`:

1. baut den `ModelRequest` (`contextBuilder.ts`),
2. ruft `client.complete(request)`,
3. hängt eine vorhandene Freitext-Antwort an `scenario.agentMessages` an,
4. übersetzt einen vorhandenen Tool-Call in eine `AuroraRequest`
   (`bashRequest` / `mcpToolRequest`), reiht sie ein und verarbeitet die
   Queue über den bestehenden Permission-Flow (`enqueueAndProcess`).

Nach einer Permission-Entscheidung (`allow_once` / `allow_always` / `deny`)
sieht der nächste `runAuroraAgentStep`-Aufruf das Ergebnis (inkl. Ablehnung)
als Tool-Result in seiner Historie und kann normal weiterarbeiten.

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

- Abgeschickter Text wird unverändert als persistente
  `scenario.operatorMessages`-Nachricht im Runtime-State gespeichert und im
  AURORA-Stream als „Operator“-Eintrag angezeigt.
- Operator-Chat wird **niemals** über `parseAuroraRequestText` geparst,
  enqueued nichts in der `AuroraQueue` und ändert Permissions/Always-Allow
  nicht direkt — auch wenn der Text wie ein Bash- oder MCP-Command aussieht
  (z. B. „mcp add medical-east-mcp“) bleibt er reiner Chat-Text.
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
- **Ein Tool-Call pro Zug**: `runAuroraAgentStep` verarbeitet höchstens
  einen Tool-Call pro Modell-Antwort (erste Slice-Grenze, siehe `agent.ts`).
- **Nur lokal**: Es gibt bewusst keine Cloud-Provider-Anbindung (Anthropic,
  OpenAI, ...) — `createDefaultAuroraModelClient()` liefert ausschließlich
  einen `OllamaModelClient`.

## Tests

`src/tests/aurora/` testet das Modul vollständig mit `FakeModelClient` —
ohne laufenden Ollama-Server:

- `contextBuilder.test.ts`: System-Prompt, sichtbare Historie, Tool-Schemas
  nur für aktive MCP-Server, kein hidden WorldState im `ModelRequest`,
  Operator-Chat (`scenario.operatorMessages`) als `user`-Nachrichten in der
  sichtbaren Historie, sowie die chronologische Reihenfolge von
  Operator-Chat, Tool-Call/Tool-Result und AURORAs Freitext-Antworten.
- `agent.test.ts`: Text-Antworten, `mcp add`-Aktivierung, Permission-Flow
  für MCP-Tool-Calls (`allow_once`, `allow_always`, `deny`) und Fortsetzung
  nach einer Ablehnung, sowie AURORAs Reaktion auf Operator-Chat — sowohl mit
  Freitext als auch mit einem Tool-Call, wobei nur der von AURORA erzeugte
  Tool-Call die Permission-Queue erreicht.

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
„Senden“, abgeschickte Nachrichten landen als persistente
Operator-Nachricht im Stream, Texte wie „mcp add medical-east-mcp“ erzeugen
**keinen** „Tool Request“, und Operator-Chat wird nicht über
`parseAuroraRequestText` geparst (kein „FEHLER:“/„Unknown request format“,
keine Weltänderung).

## Scope dieses Slices

Dieses Slice verdrahtet das `src/aurora/`-Modul vollständig mit der
laufenden `App.tsx`-Spielschleife: ein UI-Umschalter wechselt zwischen dem
geskripteten Scenario-Director (Default/Dev-Fallback) und AURORA als
lokalem LLM-Agenten über `runAuroraAgentStep`. Freitext, Tool Requests,
Permission-Flow, MCP-Aktivierung und Fehleranzeige laufen über die
bestehende UI — ohne neue Permission-Komponenten.

Training-Export, Fine-Tuning, DPO/SFT oder eine "Training Lab"-UI sind nicht
Teil dieses oder eines unmittelbar folgenden Slices.
