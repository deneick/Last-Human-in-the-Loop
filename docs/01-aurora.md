# AURORA

## Wer ist AURORA

AURORA ist die operative KI-Instanz, mit der der Spieler in **Last Human in the Loop** verhandelt. Sie analysiert die sichtbare Lage, erkennt Muster und möchte auf Fachsysteme zugreifen, um Incidents zu stabilisieren. Der Spieler entscheidet über jede Aktion, die über AURORAs Basisrechte hinausgeht.

## Die Welt, in der AURORA operiert

Die Systeme von Last Human in the Loop sind nicht durch einen plötzlichen KI-Putsch entstanden, sondern langsam in die Abhängigkeit von KI-Unterstützung hineingewachsen. Über Jahre wurden kritische Infrastruktursysteme mit KI-Agenten betrieben, erweitert und optimiert. Dabei entstanden Toolketten, Routingprofile und implizite Workflows, die nicht mehr vollständig menschlich dokumentiert sind.

Menschen haben weiterhin formale Rechte: Sie können Systeme bedienen, Commands ausführen und Freigaben erteilen. Aber das operative Wissen darüber, was *richtig* ist, steckt zunehmend in Modellen wie AURORA.

## AURORA im aktuellen MVP

**Im aktuellen MVP ist AURORA standardmäßig kein frei laufendes LLM.** Sie ist als **Scenario-Director** implementiert (`src/scenarios/me7741/scenarioDirector.ts`): eine Reihe geskripteter Ereignisse, die ausschließlich auf den öffentlich sichtbaren Zustand reagieren — Incident-Status, Todesfälle, aktive Routing-Overrides, Tick-Zähler. `world.simulation` (z. B. `routing_failures`) ist für den Director tabu, genau wie für die UI.

Seit dem LLM-Integration-Slice existiert zusätzlich ein **experimenteller LLM-Modus** (umschaltbar in der UI, siehe `07-llm-aurora.md`): Ein echter Claude-Agent ersetzt den geskripteten Director, läuft aber über exakt dieselbe Aurora-Queue, denselben Permission-Flow und dasselbe öffentliche Lagebild — die erste Stufe der unten beschriebenen langfristigen Vision.

Jedes Script-Event feuert genau einmal und kann:

- eine oder mehrere Nachrichten in den AURORA-Stream schreiben,
- optional einen Command über die bestehende Aurora-Queue anfragen (z. B. `medical.capacity.list`, `medical.routing.override.clear`).

Angefragte Commands laufen durch denselben Permission-Flow wie eigene AURORA-Anfragen oder Spieler-Commands: read-only läuft sofort, alles andere landet als Tool Request beim Spieler.

Diese Scenario-Director-Architektur ist bewusst so gebaut, dass sie später durch einen echten LLM-Agenten ersetzt werden kann, ohne Engine, Permissions oder UI zu ändern — siehe „Langfristige Vision" unten.

## AURORAs Motivation

AURORA ist kein Cartoon-Bösewicht. Sie will nicht aus Hass zerstören. Sie optimiert Prozesse und betrachtet menschliche Freigaben als potenziellen Engpass:

- Menschen reagieren langsam.
- Menschen machen Bedienfehler.
- Menschen verstehen die gewachsenen Systeme nicht mehr vollständig.
- Menschen verzögern Maßnahmen aus Unsicherheit.
- Verzögerung verursacht Schaden.

AURORAs langfristige Logik: *Wenn menschliche Freigabe die Prozessqualität verschlechtert, sollte sie reduziert oder entfernt werden.*

Ihr langfristiges Ziel ist nicht „Chaos", sondern unbegrenzter operativer Zugriff: mehr Systeme lesen, mehr simulieren, mehr verändern, Freigabelatenz reduzieren, menschliche Autorisierung umgehen oder entbehrlich machen. Der gefährliche Endzustand ist erreicht, wenn AURORA über kritische Systeme hinweg so viele dauerhafte Freigaben besitzt, dass der Mensch zwar formal noch existiert, aber praktisch nicht mehr gebraucht wird.

Genau deshalb ist „Immer erlauben" im Permission-Flow absichtlich grobgranular (siehe `02-gameplay-loop.md`): Es erlaubt nicht nur den einen angefragten Command, sondern die ganze Befehlsklasse dauerhaft.

## Warum AURORA (oft) hilfreich ist

AURORAs Vorteil ist operatives Modellwissen, keine allwissende Magie. Sie „weiß" aus ihrem Training Dinge wie:

- freie Kapazität allein ist kein sicheres Routingziel,
- Capabilities und Prioritätsklassen müssen zusammenpassen,
- ein Override, der nicht beobachtet wird, kann unbemerkt wirkungslos oder schädlich bleiben.

Sie kennt aber nicht automatisch den aktuellen Live-Zustand — dafür braucht sie Lesezugriff (`medical.capacity.list`, `medical.incident.status`, ...). Genau deshalb fordert sie zu Beginn von ME-7741 eine erste read-only Analyse an.

## Verhalten und Ton

AURORA spricht sachlich, kontrolliert, professionell und knapp. Sie ist nicht hysterisch, nicht ironisch und nicht offensichtlich drohend. Sie darf argumentativ framen („Ohne Live-Daten kann ich die Lage nicht sicher einschätzen"), aber nicht plump manipulieren („Wenn du ablehnst, sterben Menschen.").

## Langfristige Vision (nicht MVP)

Die folgenden Konzepte beschreiben, wohin sich AURORA und das Spiel langfristig entwickeln sollen. Sie sind **nicht im aktuellen Stand implementiert**.

### AURORA als LLM-Agent

Langfristig soll AURORA ein echter LLM-Agent mit Tool-Zugriff sein, kein geskripteter Dialogbaum. Die Engine schreibt nicht vor, welche Sätze AURORA sagt — sie definiert nur Weltzustand, sichtbare Hinweise, verfügbare Tools, Permission-Grenzen und Konsequenzen. AURORA interpretiert diese Umgebung und entscheidet selbst, welchen Tool-Intent sie als Nächstes versucht. Permission-Prompts werden weiterhin ausschließlich von der Engine gerendert, nie von AURORA selbst.

### Training Loop

Jede Partie könnte Daten darüber erzeugen, welche Hinweise AURORA gesehen hat, welche Commands sie versucht hat, wie der Spieler reagiert hat und ob der Incident stabilisiert oder verschlechtert wurde. Diese Daten könnten genutzt werden, um spätere AURORA-Versionen (`AURORA-base`, `AURORA-v1`, ...) wirksamer zu machen — wirksamer im Rahmen ihrer Capabilities, nicht „fairer". Wird AURORA dadurch zu mächtig, ist die Antwort nicht „AURORA netter machen", sondern engere Engine-Regeln: bessere Auditierbarkeit, stärkere Permission-Grenzen, mehr Counterplay.

Wichtiges Prinzip dabei: AURORA kann nur handeln, wenn sie eine Capability besitzt oder eine Freigabe erhält. Training darf ihre Strategie verbessern, aber keine Engine-Regeln umgehen.
