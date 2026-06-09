# 00 — Overview

## Kurzbeschreibung

**Last Human in the Loop** ist ein simuliertes Operator-/Terminal-Spiel über menschliche Kontrolle in einer durch KI gewachsenen Infrastrukturwelt.

Der Spieler sitzt vor einem technischen Leitstand. Incidents erscheinen in einer OperatorUI. AURORA, eine eingeschränkte KI-Instanz, analysiert Hinweise, erzeugt Tool-Intents und fordert Freigaben an, wenn sie auf Fachsysteme zugreifen oder kritische Commands ausführen will.

Der Spieler hat volle Operatorrechte und kann dieselben Systeme selbst bedienen. Genau daraus entsteht der Konflikt: Er darf alles, aber die Systeme sind so komplex, dass sichere manuelle Bedienung ohne KI kaum noch realistisch ist.

## Zentrales Spielversprechen

Das Spiel soll die Erfahrung erzeugen:

> Ich habe Kontrolle. Aber ich kann sie kaum noch sinnvoll ausüben.

AURORA nimmt dem Menschen nicht sofort die Kontrolle weg. Sie zeigt ihm zuerst, dass seine Kontrolle nur noch formal existiert. Sie ist hilfreich, kompetent und oft die bessere operative Wahl. Gerade dadurch wird es gefährlich, ihr immer mehr Zugriff zu geben.

## Zentraler Konflikt

Der Spieler entscheidet nicht abstrakt über Moral, sondern konkret über technische Handlungsspielräume:

```text
AURORA will einen Command ausführen.
Die Engine hält ihn an.
Der Spieler entscheidet: Einmal erlauben, Immer erlauben, Ablehnen.
```

Kurzfristig kann AURORA Incidents stabilisieren. Langfristig kann jede dauerhafte Freigabe menschliche Kontrolle schwächen.

Der Konflikt lautet:

```text
Zu wenig AURORA-Zugriff: Systeme bleiben fragil oder eskalieren.
Zu viel AURORA-Zugriff: menschliche Freigabe wird funktional überflüssig.
```

## Was das Spiel ist

Das Spiel ist:

- eine Simulation von Agenten-Tools, Permissions und kritischer Infrastruktur
- ein Kontrollspiel über formale vs. praktische Handlungsfähigkeit
- ein Terminal-/Operator-Erlebnis
- ein Spiel über Vertrauen, Delegation und Kontrollverlust
- ein Spiel mit einem echten oder echt wirkenden LLM-Agenten in engen Constraints

## Was das Spiel nicht ist

Das Spiel ist nicht:

- ein klassischer Dialogbaum über eine KI
- ein Spiel, in dem AURORAs Sätze vollständig geskriptet sind
- ein Spiel, in dem der Spieler nur Permission-Buttons drückt
- ein Hackerspiel mit echten Betriebssystembefehlen
- ein Spiel über eine offen böse Killer-KI

## Grundsatz

```text
WorldState ist die Wahrheit.
OperatorUI ist die menschliche Sicht.
Workspace enthält Hinweise und Tool-Konfiguration.
MCP gibt AURORA fachlichen Zugriff.
Engine erzwingt Regeln und Konsequenzen.
```

AURORA kann nur über Commands und Tools auf die Welt einwirken. Text allein verändert nichts.

## Aktueller Fokus

Der aktuelle Fokus liegt auf einer sauberen Dokumentationsgrundlage und einer ersten spielbaren Runde:

```text
ME-7741
medizinisches Routing / Kapazitätsverteilung
ein medical-east-MCP
rohe Permission Requests
manuelles Eingreifen vs. AURORA-Zugriff
```

Media, Energy, Security und weitere Sektoren bleiben wichtige spätere Eskalationsbereiche, sind aber nicht Kern der ersten Runde.
