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
3. bereits bearbeiteten Aurora-Anfragen — als Tool-Call + Tool-Result-Paar,
   ohne den internen WorldState-Patch,
4. AURORAs eigenen vorherigen Freitext-Antworten (`scenario.agentMessages`).

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

## Tests

`src/tests/aurora/` testet das Modul vollständig mit `FakeModelClient` —
ohne laufenden Ollama-Server:

- `contextBuilder.test.ts`: System-Prompt, sichtbare Historie, Tool-Schemas
  nur für aktive MCP-Server, kein hidden WorldState im `ModelRequest`.
- `agent.test.ts`: Text-Antworten, `mcp add`-Aktivierung, Permission-Flow
  für MCP-Tool-Calls (`allow_once`, `allow_always`, `deny`) und Fortsetzung
  nach einer Ablehnung.

## Scope dieses Slices

Dieses Slice liefert das vollständige, getestete `src/aurora/`-Modul als
eigenständige Schicht über dem bestehenden Runtime-State. Die Verdrahtung
mit der laufenden `App.tsx`-Spielschleife (Aurora-Schritt statt/parallel zum
Scenario-Director, async UI-Update, Live-Anzeige von `agentMessages`) ist
bewusst ein eigener Folge-Slice — analog zu den bisherigen GRID-1182-Slices.
Training-Export, Fine-Tuning, DPO/SFT oder eine "Training Lab"-UI sind nicht
Teil dieses oder eines unmittelbar folgenden Slices.
