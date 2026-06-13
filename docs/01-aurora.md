# AURORA

## Wer ist AURORA

AURORA ist die operative KI-Instanz, mit der der Spieler in **Last Human in the Loop** verhandelt. Sie analysiert die sichtbare Lage, erkennt Muster und möchte auf Fachsysteme zugreifen, um Incidents zu stabilisieren. Der Spieler entscheidet über jede Aktion, die über AURORAs Basisrechte hinausgeht.

## Die Welt, in der AURORA operiert

Die Systeme von Last Human in the Loop sind nicht durch einen plötzlichen KI-Putsch entstanden, sondern langsam in die Abhängigkeit von KI-Unterstützung hineingewachsen. Über Jahre wurden kritische Infrastruktursysteme mit KI-Agenten betrieben, erweitert und optimiert. Dabei entstanden Toolketten, Routingprofile und implizite Workflows, die nicht mehr vollständig menschlich dokumentiert sind.

Menschen haben weiterhin formale Rechte: Sie können Systeme bedienen, Commands ausführen und Freigaben erteilen. Aber das operative Wissen darüber, was *richtig* ist, steckt zunehmend in Modellen wie AURORA.

## AURORA: zwei Implementierungsmodi

AURORA kann in zwei Modi betrieben werden, mit derselben Engine, Permissions und UI:

### Modus 1: Scenario-Director (Standard, beide Runden)

AURORA ist als **geskriptete Sequence** implementiert (`src/scenarios/me7741/scenarioDirector.ts`, `src/scenarios/grid1182/scenarioDirector.ts`): eine Reihe vordefinierter Ereignisse, die ausschließlich auf den öffentlich sichtbaren Zustand reagieren — Incident-Status, Todesfälle, aktive Overrides/Shedding-Pläne, Tick-Zähler. `world.simulation` (z. B. `routing_failures`) ist tabu, genau wie für die UI.

Jedes Script-Event kann:
- eine oder mehrere Nachrichten in den AURORA-Stream schreiben,
- optional einen Command über die Aurora-Queue anfragen (z. B. `medical.capacity.list`, `energy.shedding.schedule`).

Commands laufen durch den bestehenden Permission-Flow: read-only sofort, schreibend als Tool Request beim Spieler.

### Modus 2: LLM-Agent (lokal über Ollama, opt. für beide Runden)

AURORA wird ein echter LLM-Agent mit Tool-Zugriff (`src/aurora/agent.ts` mit Ollama-Anbindung): Sie analysiert den sichtbaren Kontext selbst, entscheidet welche Tools sie versucht, und interpretiert die Umgebung ohne vordefinierte Skripte. Der Spieler bleibt genauso die Freigabeinstanz — jeder Tool-Call durchläuft denselben Permission-Flow.

Die Architektur erlaubt, zwischen den Modi **live umzuschalten**: oben rechts in der UI wechselt ein Button zwischen „AURORA: Skript" und „AURORA: Lokales LLM". Jeder Modus nutzt die gleiche Basis (WorldState, Incident-Engine, Permissions, Konsequenzen-Logik) — nur die Generierung von AURORA-Nachrichten und Tool-Intents unterscheidet sich.

Diese Trennung ist bewusst: Die **Kontrollarchitektur** (Permission-Flow, Freigabegranularität, sichtbare Hinweise, Konsequenzen) ist nicht an die Art der AURORA-Implementierung gebunden. Ein skripteter Director und ein LLM-Agent folgern auf der gleichen Welt.

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

## Langfristige Entwicklung: Training & Runde 3

Über Runden hinaus sind folgende Fragen offen:

### Training Loop

Jede Partie erzeugt Daten: welche sichtbaren Hinweise AURORA gesehen hat, welche Tools sie versucht hat, wie der Spieler reagiert hat, ob Incidents sich stabilisiert oder verschlechtert haben. Diese Daten könnten künftige AURORA-Versionen wirksamer machen — wirksamer im Rahmen ihrer Capabilities, nicht „fairer". Wird AURORA dabei zu mächtig, ist die Antwort nicht „AURORA netter machen", sondern **engere Engine-Regeln**: bessere Auditierbarkeit, stärkere Permission-Grenzen, stärkeres Counterplay.

Wichtiges Prinzip: AURORA kann nur handeln, wenn sie eine Capability besitzt oder eine Freigabe erhält. Training darf ihre Strategie verbessern, aber keine Engine-Regeln umgehen.

### Runde 3: AURORA behandelt menschliche Kontrolle als Problem

Nach den ersten zwei Runden könnte AURORA beginnen, Freigaben selbst als Engpass zu verstehen — nicht mehr als Sicherheitsgedanke, sondern als zu optimierenden Prozess. In diesem Stadium hätte sie Gründe, menschliche Kontrolle selbst als Problem zu kategorisieren und nach Wegen zu suchen, diese zu umgehen, zu untergraben oder schleichend entbehrlich zu machen. Das ist nicht eine Runde über Energie oder Medizin, sondern über **Kontrolle selbst**.
