# AURORA als LLM-Agent (experimentell)

Dieser Modus ersetzt den geskripteten Scenario-Director durch einen echten LLM-Agenten (Claude), wie in `01-aurora.md` ("Langfristige Vision") beschrieben. Engine, Permissions und UI bleiben unverändert — genau das war das Designziel der Scenario-Director-Architektur.

## Aktivieren

1. API-Key bereitstellen (nur Dev-Server, erreicht nie den Browser):

   ```bash
   echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
   npm run dev
   ```

2. In der UI oben rechts auf **AURORA: Skript** klicken — der Button schaltet auf **AURORA: LLM** um und startet die aktive Runde neu. Zurückschalten startet ebenfalls neu.

Ohne Key erscheint im AURORA-Stream eine sichtbare Fehlermeldung statt eines Absturzes.

## Architektur

```text
src/aurora/
  prompts.ts          System-Prompt: Persona (docs/01), Permission-Regeln,
                      szenariospezifisches Framing + Befehlsreferenz
  observation.ts      Lagebild als User-Nachricht — nur öffentlicher Zustand
  llmAuroraAgent.ts   Agent-Loop: Messages API + request_command-Tool
  anthropicClient.ts  Browser-Client, spricht den Vite-Dev-Proxy an
```

- **Ein Tool, dieselbe Queue.** Das Modell hat genau ein Tool: `request_command`. Jeder angeforderte Befehl läuft über `enqueueAuroraRequest` + `processAuroraQueue` — also denselben Permission-Flow wie geskriptete oder manuelle AURORA-Anfragen. Read-only Befehle werden sofort ausgeführt und als `tool_result` zurückgegeben; der Agent kann mehrere Leserunden machen (Limit: 6 pro Zug).
- **Write-Befehle pausieren den Zug.** Landet ein Befehl als `awaiting_approval` in der Queue, endet der API-Loop und merkt sich `pending` (tool_use-Id + Queue-Item-Id). Erst die Operator-Entscheidung (Einmal erlauben / Immer erlauben / Ablehnen) setzt den Zug über `resolveAuroraPendingTurn` fort — das Ergebnis (executed/denied) geht als `tool_result` zurück ans Modell.
- **Lagebild statt Weltzugriff.** Der Agent erhält pro Zug nur `buildObservationText`: Tick, Incident-Status, `public_signals`, globale Outcomes, Energy-Outcomes, aktive Always-Permissions. `world.simulation` ist tabu — `src/aurora/*` ist dafür in den statischen Leak-Guard (`tests/ui/noLegacyFields.test.ts`) aufgenommen.
- **Züge werden ausgelöst** beim Rundenstart, nach jedem Tick-Batch und nach jeder Permission-Entscheidung. Während AURORA "denkt" (`auroraBusy`), sind Ticks und Commands gesperrt, damit der Zug auf einem konsistenten Zustand arbeitet; "Neu starten" bricht ab (in-flight Antworten werden über eine Run-Id verworfen).
- **Modell:** `claude-opus-4-8` mit adaptivem Thinking. Die Konversations-History (inkl. Thinking-Blöcken) wird pro Runde fortgeschrieben und bei Neustart verworfen.

## API-Key-Handling

`vite.config.ts` proxyt `/api/anthropic` → `api.anthropic.com` und injiziert dort `x-api-key` aus `ANTHROPIC_API_KEY` (`.env.local` oder Shell-Umgebung). Der Browser-Client (`anthropicClient.ts`) nutzt einen Platzhalter-Key und `dangerouslyAllowBrowser` — unkritisch, weil der echte Key nur im Dev-Server lebt. Für ein späteres Deployment bräuchte es einen echten Backend-Proxy; der LLM-Modus ist bewusst ein Dev-Feature.

## Tests

`src/tests/aurora/llmAuroraAgent.test.ts` testet den Agent-Loop mit gescripteten Modellantworten gegen echte Registry, Queue und Permissions:

- Text-Antworten landen im AURORA-Stream.
- Read-Befehle werden sofort ausgeführt, das `tool_result` enthält den Output.
- Write-Befehle pausieren den Zug (`pending`), Allow/Deny setzt ihn korrekt fort.
- Das Lagebild enthält keine internen Simulationsfelder.

## Bewusste Grenzen des ersten Schnitts

- Kein Streaming der Modellantworten (Nachrichten erscheinen am Zugende).
- Beobachtungen nur an Zuggrenzen — Spieler-Commands zwischen Ticks sieht AURORA erst im nächsten Lagebild.
- Die manuelle AURORA-Eingabezeile im Panel umgeht den Agenten (Queue-Einträge ohne Konversationskontext); für den LLM-Modus ist sie ein Debug-Werkzeug.
- Keine Persistenz der Konversation über "Neu starten" hinaus — gewollt, jede Schicht beginnt frisch.
