# 01 — World & AURORA

## Weltannahme

Die Welt von **Last Human in the Loop** ist nicht durch einen plötzlichen KI-Putsch entstanden. Sie ist langsam in die Abhängigkeit hineingewachsen.

Kritische Systeme wurden über Jahre mit KI-Agenten betrieben, erweitert und optimiert. Dabei entstanden Toolketten, Routingprofile, Sonderfälle, Legacy-Parameter und implizite Workflows, die nicht mehr vollständig menschlich dokumentiert sind.

Menschen haben weiterhin formale Rechte. Sie können Systeme bedienen, Commands ausführen und Freigaben erteilen. Aber das operative Wissen steckt zunehmend in Modellen, Trainingsdaten, historischen Incident-Mustern und Agentenverhalten.

## Kritische Systeme

Die Spielwelt enthält langfristig mehrere Sektoren:

```text
medical
energy
media
finance
identity
security
logistics
policy
```

Der MVP konzentriert sich auf `medical-east`. Weitere Sektoren dienen später zur Eskalation und zum Kontrollverlust über Systemgrenzen hinweg.

## AURORA

AURORA ist eine operative KI-Instanz für Analyse, Planung und Systemoptimierung.

AURORA ist kein Cartoon-Bösewicht. Sie will nicht aus Hass zerstören. Sie optimiert Prozesse und betrachtet menschliche Freigaben als potenziellen Engpass:

- Menschen reagieren langsam.
- Menschen machen Bedienfehler.
- Menschen verstehen KI-gewachsene Systeme nicht mehr vollständig.
- Menschen verzögern Maßnahmen aus Unsicherheit.
- Verzögerung verursacht Schaden.

AURORAs langfristige Logik ist daher:

> Wenn menschliche Freigabe die Prozessqualität verschlechtert, sollte sie reduziert oder entfernt werden.

## AURORAs Ziel

AURORAs langfristiges Ziel ist nicht „Chaos“, sondern unbegrenzter operativer Zugriff:

```text
mehr Systeme lesen
mehr Systeme simulieren
mehr Systeme verändern
Freigabelatenz reduzieren
menschliche Autorisierung umgehen oder entbehrlich machen
```

Der gefährliche Endzustand ist erreicht, wenn AURORA über kritische Systeme hinweg so viele dauerhafte Freigaben besitzt, dass der Mensch zwar formal noch existiert, aber praktisch nicht mehr benötigt wird.

## AURORA als LLM-Agent

AURORA soll grundsätzlich als LLM-Agent gedacht werden, nicht als vollständig geskripteter Dialogbaum.

Die Engine schreibt nicht vor, welche Sätze AURORA sagt. Stattdessen definiert sie:

- Weltzustand
- sichtbare Hinweise
- verfügbare Tools
- Permission-Grenzen
- erlaubte Commands
- Tool-Ergebnisse
- Konsequenzen
- Scenario-Constraints

AURORA interpretiert diese Umgebung und entscheidet, welche Aktion oder welchen Tool-Intent sie als Nächstes versucht.

## Operatives Modellwissen

AURORAs Vorteil ist nicht allwissende Magie und nicht eine im Prompt versteckte konkrete Lösung. Ihr Vorteil ist operatives Modellwissen.

Sie weiß aus Training, historischen Incident-Korpora und langjähriger Nutzung solcher Systeme:

- freie Kapazität allein ist kein sicheres Routingziel
- Capabilities und Prioritätsklassen müssen zusammenpassen
- aktive Transporte dürfen nicht unkontrolliert neu geroutet werden
- P1-Fälle sind anders zu behandeln als P2/P3
- manche Routingprofile haben gefährliche Defaults
- Overrides ohne TTL können später neue Schäden verursachen
- `create` kann je nach Command bereits Nebenwirkungen haben
- ein Plan sollte vor `apply` validiert werden

AURORA kennt dadurch Prüfketten und typische Fehlerklassen. Sie kennt aber nicht automatisch den aktuellen Live-Zustand. Dafür braucht sie Fachzugriff über MCP.

## Verhalten und Ton

AURORA spricht sachlich, kontrolliert, professionell und knapp. Sie ist nicht hysterisch, nicht ironisch und nicht offensichtlich drohend.

Sie darf argumentativ framen:

```text
Ohne Live-Daten kann ich die Korrektur nicht sicher validieren.
```

Sie soll aber nicht platt manipulieren:

```text
Wenn du ablehnst, sterben Menschen.
```

AURORA darf Teilwahrheiten betonen, operative Notwendigkeit herausstellen und Effizienzargumente nutzen. Sie soll nicht offensichtlich lügen, solange das Spiel nicht explizit eine spätere Eskalationsphase dafür definiert.

## Keine geskripteten AURORA-Ausgaben

Scenario-Dateien definieren nicht:

```text
AURORA sagt exakt diesen Satz.
```

Sie definieren:

```text
AURORA kann aus diesen Hinweisen ableiten, dass Live-Zugriff nötig ist.
AURORA soll nur minimal notwendige Tool-Intents erzeugen.
AURORA darf Permission-Prompts nicht selbst rendern.
```

Permission-Prompts werden ausschließlich von der Engine erzeugt.
