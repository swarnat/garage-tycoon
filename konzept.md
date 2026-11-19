Garage Tycoon – Spielkonzept und technische Spezifikation

1. Projektübersicht

Projektname: Garage Tycoon (Arbeitstitel)
Genre: 2D-Wirtschaftssimulation / Werkstattmanagement
Plattform: Webbrowser, Desktop-first
Technologie: TypeScript, Vite, PixiJS, HTML, CSS
Datenspeicherung: Ausschließlich Browser localStorage
Backend: Keines
Spielmodus: Singleplayer, vollständig offline spielbar
Grafikstil: 2D Top-Down, orientiert an der Übersichtlichkeit von Prison Architect und RimWorld

Grundidee

Der Spieler betreibt eine eigene Kfz-Werkstatt und übernimmt die wirtschaftliche und organisatorische Führung des Unternehmens.

Regelmäßig treffen Kunden mit Fahrzeugen und Reparaturaufträgen ein. Der Spieler muss die Aufträge bewerten, annehmen, diagnostizieren lassen, passende Ersatzteile beschaffen und Reparaturen durch seine Mitarbeiter durchführen lassen.

Der Spieler führt keine Reparaturen selbst durch.

Alle praktischen Arbeiten werden durch Mitarbeiter ausgeführt. Deren Bewegungen und Tätigkeiten sind direkt in der 2D-Spielwelt sichtbar.

Der Fokus liegt auf:

* Wirtschaftlicher Planung und Gewinnoptimierung
* Auftragsmanagement und Terminplanung
* Personalverwaltung und Mitarbeiterauslastung
* Ersatzteilbeschaffung und Lagerwirtschaft
* Effizienter Nutzung der Werkstattkapazitäten
* Ausbau und Weiterentwicklung des Unternehmens
* Kundenzufriedenheit und Reputation

Das Spiel soll leicht verständlich, visuell ansprechend und wirtschaftlich anspruchsvoll sein.

⸻

2. Zentrale Spielmechanik

Gameplay-Loop

1. Ein Kunde bringt ein Fahrzeug mit einem Problem oder Reparaturwunsch.
2. Der Spieler prüft und akzeptiert den Auftrag.
3. Das Fahrzeug wird einem freien Stellplatz zugewiesen.
4. Ein Mitarbeiter führt bei Bedarf eine Diagnose durch.
5. Die notwendigen Reparaturen und Ersatzteile werden ermittelt.
6. Der Spieler kalkuliert und genehmigt die Arbeiten.
7. Benötigte Ersatzteile werden aus dem Lager entnommen oder bestellt.
8. Mitarbeiter führen die Reparatur selbstständig durch.
9. Eine abschließende Qualitätskontrolle findet statt.
10. Der Auftrag wird abgeschlossen und abgerechnet.
11. Der Kunde erhält sein Fahrzeug zurück.
12. Die wirtschaftlichen Ergebnisse beeinflussen die Entwicklung der Werkstatt.

Mehrere Aufträge können gleichzeitig in unterschiedlichen Bearbeitungsphasen existieren.

Spielprinzipien

* Die Simulation läuft zeitbasiert.
* Mitarbeiter handeln weitgehend autonom.
* Der Spieler übernimmt Planung und Management.
* Aufträge bestehen aus mehreren abhängigen Arbeitsschritten.
* Mitarbeiter, Arbeitsplätze und Ersatzteile sind begrenzte Ressourcen.
* Wirtschaftliche Entscheidungen haben nachvollziehbare Konsequenzen.
* Alle relevanten Aktivitäten werden sichtbar dargestellt.

⸻

3. Spielwelt und Grafik

Darstellung

Die Werkstatt wird in einer orthogonalen 2D-Draufsicht dargestellt.

Die Welt basiert auf einem Tile-Grid und lässt sich mit der Maus verschieben und zoomen.

Die Darstellung soll funktional, übersichtlich und lebendig sein.

Werkstattbereiche

Die Werkstatt kann folgende Bereiche enthalten:

* Einfahrt und Ausfahrt
* Kundenparkplätze
* Fahrzeugstellplätze
* Reparaturarbeitsplätze
* Hebebühnen
* Diagnoseplätze
* Ersatzteillager
* Werkzeugschränke
* Büro und Kundenannahme
* Wartebereich
* Mitarbeiterraum

Nicht alle Bereiche müssen in der ersten Version verfügbar sein.

Sichtbare Aktivitäten

Mitarbeiter und Fahrzeuge werden als 2D-Sprites dargestellt.

Mitarbeiter können:

* Zum Fahrzeug laufen
* Ersatzteile aus dem Lager holen
* Werkzeuge verwenden
* Diagnosen durchführen
* An Fahrzeugen arbeiten
* Zwischen Arbeitsplätzen wechseln
* Pausen machen
* Feierabend haben

Fahrzeuge können:

* Die Werkstatt anfahren
* Auf Stellplätzen stehen
* Auf Arbeitsplätze umgesetzt werden
* Auf Hebebühnen stehen
* Nach Abschluss die Werkstatt verlassen

Animationen

Für den Anfang reichen einfache Animationen:

* Laufanimation
* Arbeit am Motorraum
* Arbeit am Rad
* Arbeit unter dem Fahrzeug
* Bedienung eines Diagnosegeräts
* Öffnen der Motorhaube
* Bewegung zum Ersatzteillager

Animationen dienen ausschließlich der Visualisierung. Der tatsächliche Arbeitsfortschritt wird durch die Simulationslogik berechnet.

Wegfindung

Mitarbeiter bewegen sich auf begehbaren Tiles.

Für die Wegfindung wird A* verwendet.

Arbeitsplätze, Lagerregale und andere Objekte besitzen definierte Interaktionspositionen.

Eine Aufgabe kann nur begonnen werden, wenn der Mitarbeiter den benötigten Arbeitsplatz erreichen kann.

⸻

4. Fahrzeuge

Fahrzeugdaten

Jedes Fahrzeug besitzt:

* Eindeutige ID
* Hersteller
* Modell
* Baujahr
* Kilometerstand
* Fahrzeugklasse
* Zustand der Baugruppen
* Aktuelle Defekte
* Besitzer/Kunde
* Zugehörigen Auftrag
* Position in der Werkstatt

Baugruppen

Fahrzeuge bestehen aus mehreren Baugruppen:

* Motor
* Getriebe
* Bremsanlage
* Fahrwerk
* Elektrik
* Kühlsystem
* Abgasanlage
* Klimaanlage
* Karosserie

Jede Baugruppe kann mehrere Komponenten enthalten.

Fahrzeugkomponenten

Beispiele:

Motor

* Zündkerzen
* Zündspulen
* Ölfilter
* Luftfilter
* Keilriemen
* Wasserpumpe

Bremsanlage

* Bremsbeläge
* Bremsscheiben
* Bremssättel
* Bremsleitungen

Fahrwerk

* Stoßdämpfer
* Federn
* Querlenker
* Radlager

Elektrik

* Batterie
* Lichtmaschine
* Anlasser
* Sensoren

Defekte

Defekte können durch Laufleistung, Alter, Verschleiß oder Zufall entstehen.

Ein Fahrzeug kann mehrere Defekte besitzen.

Nicht jeder Defekt ist bei der Auftragsannahme bekannt.

⸻

5. Auftragsmanagement

Auftragserstellung

Neue Aufträge werden automatisch durch die Spielsimulation generiert.

Die Anzahl und Qualität neuer Aufträge hängt ab von:

* Reputation der Werkstatt
* Auftragslage
* Spielentwicklung
* Kundenzufriedenheit
* Zufälligen Ereignissen

Auftragstypen

* Standardreparatur
* Wartung
* Inspektion
* Fehlerdiagnose
* Notfallreparatur
* Umfangreiche Reparatur

Auftragsdaten

Jeder Auftrag besitzt:

* Eindeutige ID
* Kunden-ID
* Fahrzeug-ID
* Kundenbeschreibung
* Tatsächliche Defekte
* Bereits diagnostizierte Defekte
* Erforderliche Reparaturen
* Benötigte Ersatzteile
* Geschätzte Arbeitszeit
* Tatsächliche Arbeitszeit
* Gewünschten Fertigstellungstermin
* Priorität
* Status
* Kalkulierten Preis
* Tatsächlichen Rechnungsbetrag
* Kundenzufriedenheit

Auftragsstatus

* incoming
* accepted
* waiting_for_diagnosis
* diagnosing
* waiting_for_approval
* waiting_for_parts
* ready_for_repair
* repairing
* quality_check
* completed
* delivered
* cancelled

Statusübergänge müssen nachvollziehbar und validiert sein.

Auftragsannahme

Der Spieler kann Aufträge annehmen oder ablehnen.

Vor der Annahme werden folgende Informationen angezeigt:

* Fahrzeug
* Kundenmeldung
* Erwarteter Arbeitsumfang, soweit bekannt
* Gewünschter Termin
* Geschätzte Einnahmen
* Erwartete Auslastung

Die endgültigen Kosten können erst nach der Diagnose bekannt sein.

Angebote und Freigaben

Nach einer Diagnose erstellt die Werkstatt einen Kostenvoranschlag.

Dieser berücksichtigt:

* Arbeitszeit
* Stundensatz
* Ersatzteilkosten
* Ersatzteilaufschlag
* Eventuelle Zusatzleistungen

Der Kunde muss kostenpflichtige Reparaturen freigeben.

Im MVP erfolgt die Kundenentscheidung automatisch anhand einfacher Regeln wie Budgetgrenze und Kundenprofil.

⸻

6. Diagnosesystem

Grundprinzip

Die Kundenmeldung entspricht nicht zwingend der tatsächlichen Ursache des Problems.

Beispiel:

Kundenmeldung: Fahrzeug startet schlecht.

Mögliche Ursachen:

* Schwache Batterie
* Defekter Anlasser
* Problem mit der Lichtmaschine
* Defekter Sensor

Der Spieler weist einem Mitarbeiter eine Diagnose zu.

Diagnosemechanik

Die Diagnose benötigt:

* Einen verfügbaren Mitarbeiter
* Ausreichende Qualifikation
* Geeigneten Arbeitsplatz
* Gegebenenfalls Spezialwerkzeug
* Zeit

Diagnoseergebnis

Nach Abschluss werden erkannte Fehler dem Auftrag hinzugefügt.

Die Diagnosegenauigkeit hängt von Mitarbeiterfähigkeiten und Werkzeugen ab.

Unzureichend qualifizierte Mitarbeiter benötigen mehr Zeit und können zusätzliche Untersuchungen erforderlich machen.

Fehlerhafte Diagnosen sind für spätere Spielversionen vorgesehen.

⸻

7. Reparatursystem

Reparaturdefinitionen

Reparaturen werden datengetrieben definiert.

Jede Reparatur besitzt:

* ID
* Bezeichnung
* Betroffene Fahrzeugkomponente
* Benötigte Teile
* Benötigte Werkzeuge
* Erforderliche Qualifikation
* Erforderlichen Arbeitsplatztyp
* Basisarbeitszeit
* Arbeitsschritte
* Abhängigkeiten
* Qualitätsanforderungen

Beispiel: Bremsbeläge wechseln

1. Fahrzeug zum Reparaturplatz bringen
2. Fahrzeug auf Hebebühne positionieren
3. Benötigte Ersatzteile bereitstellen
4. Räder demontieren
5. Bremsbeläge austauschen
6. Räder montieren
7. Qualitätskontrolle durchführen

Jeder Schritt besitzt eine definierte Arbeitsdauer.

Arbeitsfortschritt

Die tatsächliche Arbeitsdauer wird beeinflusst durch:

* Basisarbeitszeit
* Mitarbeiterqualifikation
* Mitarbeitererfahrung
* Verfügbare Werkzeuge
* Arbeitsbedingungen

Aufgabenabhängigkeiten

Ein Arbeitsschritt darf nur starten, wenn seine Voraussetzungen erfüllt sind.

Beispiele:

* Keine Reparatur ohne benötigte Ersatzteile
* Keine Arbeit an der Hebebühne ohne freie Hebebühne
* Keine Qualitätskontrolle vor Abschluss der Reparatur
* Keine Fahrzeugauslieferung vor erfolgreicher Qualitätskontrolle

Automatische Arbeitsausführung

Mitarbeiter wählen aus verfügbaren Aufgaben automatisch geeignete Tätigkeiten aus.

Der Spieler kann Prioritäten festlegen oder Mitarbeiter direkt zuweisen.

Die Aufgabenplanung berücksichtigt:

* Qualifikation
* Verfügbarkeit
* Priorität
* Entfernung
* Erforderlichen Arbeitsplatz
* Materialverfügbarkeit

⸻

8. Mitarbeiter

Mitarbeiterdaten

Jeder Mitarbeiter besitzt:

* ID
* Name
* Gehalt
* Arbeitszeitmodell
* Aktuellen Zustand
* Position
* Zugewiesene Aufgabe
* Fähigkeiten
* Erfahrung
* Arbeitsgeschwindigkeit
* Zuverlässigkeit

Fähigkeiten

* Motor
* Elektrik
* Fahrwerk
* Bremsen
* Getriebe
* Diagnose

Fähigkeiten werden auf einer Skala von 0 bis 100 abgebildet.

Mitarbeiterzustände

* idle
* moving
* diagnosing
* repairing
* fetching_parts
* quality_check
* waiting
* break
* off_duty

Aufgabenplanung

Mitarbeiter handeln innerhalb ihres Arbeitszeitmodells selbstständig.

Die automatische Aufgabenverteilung soll verhindern, dass qualifizierte Mitarbeiter untätig bleiben, obwohl ausführbare Arbeiten vorhanden sind.

Der Spieler kann:

* Mitarbeiter einstellen
* Mitarbeiter entlassen
* Aufgaben zuweisen
* Aufträge priorisieren
* Arbeitszeiten festlegen

Personalentwicklung

Später werden ergänzt:

* Weiterbildung
* Spezialisierung
* Mitarbeiterzufriedenheit
* Krankheitsausfälle
* Überstunden
* Motivation
* Erfahrungssteigerung

⸻

9. Ersatzteilmanagement

Ersatzteildaten

Jedes Ersatzteil besitzt:

* ID
* Bezeichnung
* Kategorie
* Kompatible Fahrzeuge beziehungsweise Komponenten
* Einkaufspreis
* Verkaufspreis beziehungsweise Kalkulationsaufschlag
* Qualitätsklasse
* Lagerbestand
* Mindestbestand
* Lagerplatzbedarf

Teilekompatibilität

Ersatzteile dürfen nur verbaut werden, wenn sie mit dem betreffenden Fahrzeug kompatibel sind.

Für den MVP kann die Kompatibilität vereinfacht über Fahrzeugklassen oder Komponentenfamilien erfolgen.

Später sind hersteller-, modell- und baujahrspezifische Kompatibilitätsregeln möglich.

Lagerverwaltung

Der Spieler kann:

* Bestände einsehen
* Teile bestellen
* Teile für Aufträge reservieren
* Mindestbestände definieren
* Lagerkapazität erweitern
* Nicht benötigte Teile verkaufen

Reservierte Teile dürfen nicht gleichzeitig für mehrere Aufträge verwendet werden.

Lieferanten

Lieferanten unterscheiden sich durch:

* Teilepreise
* Lieferzeiten
* Versandkosten
* Verfügbarkeit
* Qualitätsklassen
* Mengenrabatte

Bestellablauf

1. Spieler erstellt Bestellung.
2. Einkaufskosten werden verbucht.
3. Bestellung erhält einen Liefertermin.
4. Die Simulation überwacht den Liefertermin.
5. Die Lieferung trifft ein.
6. Ersatzteile werden dem Lager gutgeschrieben.
7. Wartende Reparaturen können fortgesetzt werden.

Wirtschaftliche Bedeutung

Hohe Lagerbestände vermeiden Wartezeiten, binden jedoch Kapital.

Geringe Lagerbestände sparen Kapital, erhöhen aber das Risiko verzögerter Reparaturen.

Expresslieferungen sind schneller, aber teurer.

⸻

10. Wirtschaftssystem

Zielsetzung

Die Wirtschaftssimulation soll realistische Zusammenhänge vereinfacht und nachvollziehbar darstellen.

Der Spieler muss sowohl Liquidität als auch Rentabilität berücksichtigen.

Einnahmen

* Arbeitsleistungen
* Diagnosepauschalen
* Ersatzteilverkauf
* Wartungsleistungen
* Zusatzleistungen

Ausgaben

* Mitarbeitergehälter
* Ersatzteile
* Miete
* Strom und Betriebskosten
* Werkzeuge und Ausstattung
* Werkstattausbau
* Zinsen und Kreditraten

Preiskalkulation

Der Spieler legt einen allgemeinen Stundenverrechnungssatz fest.

Optional können für verschiedene Tätigkeiten unterschiedliche Stundensätze verwendet werden.

Der Rechnungsbetrag berechnet sich aus:

Arbeitszeit × Verrechnungssatz + Ersatzteilverkaufspreise + Zusatzleistungen

Ersatzteilpreise

Ersatzteile werden mit einem konfigurierbaren Aufschlag verkauft.

Beispiel:

* Einkaufspreis: 50 €
* Aufschlag: 40 %
* Verkaufspreis: 70 €
* Teile-Rohmarge: 20 €

Mitarbeiterkosten

Mitarbeiter verursachen regelmäßige Kosten unabhängig davon, ob sie produktiv arbeiten.

Die Auslastung ist deshalb eine wichtige wirtschaftliche Kennzahl.

Fixkosten

Die Werkstatt besitzt regelmäßige Fixkosten:

* Miete
* Versicherungen
* Grundversorgung
* Laufende Wartung der Betriebsausstattung

Gewinnrechnung

Unterschieden werden:

* Umsatz
* Materialkosten
* Personalkosten
* Sonstige Betriebskosten
* Betriebsergebnis
* Liquidität

Gewinn und Kontostand dürfen nicht gleichgesetzt werden.

Der Einkauf von Lagerbestand reduziert die Liquidität, stellt aber nicht automatisch einen vollständigen betrieblichen Verlust dar.

Finanzdashboard

Das Finanzdashboard zeigt:

* Aktuellen Kontostand
* Umsatz heute
* Umsatz im laufenden Monat
* Betriebsergebnis
* Ersatzteilkosten
* Personalkosten
* Fixkosten
* Durchschnittlichen Auftragswert
* Werkstattauslastung
* Durchschnittliche Reparaturdauer

Zusätzlich sollen einfache Diagramme die wirtschaftliche Entwicklung visualisieren.

Buchungslogik

Alle Geldbewegungen werden als nachvollziehbare Transaktionen gespeichert.

Beträge sind intern als ganzzahlige Cent-Werte abzubilden.

Die Berechnungen müssen gegen doppelte Buchungen geschützt sein.

Jeder abgeschlossene Auftrag darf nur einmal abgerechnet werden.

⸻

11. Kunden und Reputation

Kundenprofile

Kunden besitzen unterschiedliche Erwartungen:

* Preisbewusst
* Qualitätsorientiert
* Zeitkritisch
* Stammkunde
* Geschäftskunde

Kundenzufriedenheit

Die Zufriedenheit hängt ab von:

* Termintreue
* Rechnungsbetrag
* Reparaturqualität
* Bearbeitungsdauer
* Kommunikation
* Reklamationen

Reputation

Die Reputation beeinflusst:

* Anzahl neuer Aufträge
* Qualität und Umfang der Aufträge
* Zahlungsbereitschaft
* Wahrscheinlichkeit von Stammkunden

Kundenbeziehungen

Zufriedene Kunden können erneut Aufträge erteilen.

Unzufriedene Kunden können die Werkstatt meiden.

In späteren Versionen sind Bewertungen, Beschwerden und Reklamationen vorgesehen.

⸻

12. Werkstattausbau

Grundprinzip

Der Spieler startet mit einer kleinen Werkstatt.

Neue Ausstattung wird durch wirtschaftlichen Erfolg freigeschaltet oder finanziert.

Erweiterungen

* Zusätzliche Hebebühnen
* Diagnosearbeitsplätze
* Größere Lagerregale
* Spezialwerkzeuge
* Werkstatthallenerweiterung
* Büroausstattung
* Weitere Mitarbeiterplätze

Investitionen

Jede Investition besitzt:

* Anschaffungskosten
* Platzbedarf
* Kapazitätsveränderung
* Gegebenenfalls laufende Kosten
* Voraussetzungen

Flächenmanagement

In einer späteren Version kann der Spieler Arbeitsplätze frei platzieren und die Werkstatt räumlich gestalten.

Im MVP reicht ein fester Werkstattgrundriss mit freischaltbaren Arbeitsplätzen.

⸻

13. Spielzeit und Simulation

Spieluhr

Die Simulation verwendet eine zentrale Spieluhr.

Alle zeitabhängigen Vorgänge orientieren sich an dieser Uhr:

* Arbeitsfortschritt
* Lieferungen
* Termine
* Arbeitszeiten
* Löhne
* Tagesabrechnungen
* Kundenankünfte

Geschwindigkeiten

Unterstützte Geschwindigkeiten:

* Pause
* 1×
* 2×
* 4×
* 8×

Als Ausgangswert entsprechen bei 1× Geschwindigkeit eine reale Sekunde zehn Spielminuten.

Dieser Wert muss durch Balancing angepasst werden können.

Arbeitszeiten

Mitarbeiter besitzen definierte Arbeitszeiten.

Außerhalb ihrer Arbeitszeiten führen sie keine neuen Tätigkeiten aus.

Bereits laufende Arbeiten werden gemäß den Regeln für Schichtende und Überstunden behandelt.

Simulationsarchitektur

Die Simulation muss unabhängig von der Bildwiederholrate ausgeführt werden.

Ein deterministischer Fixed-Timestep-Ansatz wird empfohlen.

Zeitliche Simulation und Rendering sind konsequent voneinander zu trennen.

Die Simulation darf durch niedrige FPS nicht langsamer werden.

⸻

14. Benutzeroberfläche

Hauptansicht

Die Werkstatt bildet den Mittelpunkt der Oberfläche.

Obere Informationsleiste

Enthält:

* Kontostand
* Spieltag und Uhrzeit
* Reputation
* Aktive Aufträge
* Spielgeschwindigkeit
* Pause-Funktion

Navigation

Menüpunkte:

* Werkstatt
* Aufträge
* Mitarbeiter
* Lager
* Lieferanten
* Finanzen
* Ausbau
* Einstellungen

Detailansicht

Beim Anklicken eines Fahrzeugs werden angezeigt:

* Fahrzeugdaten
* Kundenmeldung
* Auftragsstatus
* Erkannte Defekte
* Reparaturschritte
* Ersatzteilbedarf
* Arbeitsfortschritt
* Zugewiesene Mitarbeiter
* Kalkulierte Kosten

Beim Anklicken eines Mitarbeiters werden angezeigt:

* Name
* Aktuelle Tätigkeit
* Fähigkeiten
* Zugewiesener Auftrag
* Arbeitsfortschritt
* Gehalt
* Produktivität

Benachrichtigungen

Beispiele:

* Neuer Reparaturauftrag
* Diagnose abgeschlossen
* Ersatzteile eingetroffen
* Reparatur abgeschlossen
* Auftrag verspätet
* Mitarbeiter ohne Aufgabe
* Lagerbestand niedrig
* Liquiditätswarnung

Bedienbarkeit

Die Oberfläche soll:

* Übersichtlich sein
* Möglichst wenige Klicks erfordern
* Klare Statusanzeigen besitzen
* Mit Maus und Tastatur funktionieren
* Wichtige wirtschaftliche Informationen schnell zugänglich machen

⸻

15. Technische Architektur

Technologie-Stack

Verwende:

* TypeScript mit aktiviertem Strict Mode
* Vite als Entwicklungs- und Build-System
* PixiJS für die 2D-Spielwelt
* HTML und CSS für die Benutzeroberfläche
* Vitest für automatisierte Tests
* Browser localStorage zur Speicherung

Keine Backend-Komponenten verwenden.

Keine serverseitige Datenbank verwenden.

Keine zwingenden externen APIs verwenden.

Keine Benutzeranmeldung implementieren.

Alle Spielinhalte und Assets sollen lokal ausgeliefert werden.

Architekturprinzipien

Die Anwendung wird in getrennte Bereiche aufgeteilt:

1. Simulationskern
2. Geschäftslogik
3. Datenmodelle
4. Spielwelt
5. Rendering
6. Benutzeroberfläche
7. Persistenz

Die Simulationslogik darf nicht von PixiJS oder DOM-Komponenten abhängen.

Projektstruktur

src/
├── core/
│   ├── Game.ts
│   ├── GameClock.ts
│   ├── EventBus.ts
│   ├── RandomGenerator.ts
│   └── SaveManager.ts
├── simulation/
│   ├── EconomySystem.ts
│   ├── OrderSystem.ts
│   ├── WorkerSystem.ts
│   ├── RepairSystem.ts
│   ├── DiagnosisSystem.ts
│   ├── InventorySystem.ts
│   ├── SupplierSystem.ts
│   └── CustomerSystem.ts
├── world/
│   ├── Workshop.ts
│   ├── TileMap.ts
│   ├── Pathfinding.ts
│   └── Workstation.ts
├── entities/
│   ├── Vehicle.ts
│   ├── Worker.ts
│   ├── Customer.ts
│   ├── Part.ts
│   └── RepairOrder.ts
├── rendering/
│   ├── Renderer.ts
│   ├── VehicleSprite.ts
│   ├── WorkerSprite.ts
│   └── WorkshopRenderer.ts
├── ui/
│   ├── Dashboard.ts
│   ├── OrdersPanel.ts
│   ├── WorkersPanel.ts
│   ├── InventoryPanel.ts
│   ├── FinancePanel.ts
│   └── Notifications.ts
├── persistence/
│   ├── LocalStorageAdapter.ts
│   ├── SaveMigration.ts
│   └── SaveValidation.ts
├── data/
│   ├── vehicles.json
│   ├── parts.json
│   ├── repairs.json
│   └── suppliers.json
├── styles/
├── assets/
└── main.ts

Die Struktur kann angepasst werden, wenn dadurch eine klarere Architektur entsteht.

⸻

16. Persistenz und Spielstände

Grundanforderung

Der vollständige Spielzustand wird ausschließlich im Browser gespeichert.

Es wird localStorage verwendet.

Savegame-Daten

Gespeichert werden:

* Savegame-Version
* Spielzeit
* Kontostand
* Finanztransaktionen und notwendige Finanzaggregate
* Werkstattzustand
* Mitarbeiter
* Fahrzeuge
* Aufträge
* Kunden
* Lagerbestand
* Offene Bestellungen
* Laufende Reparaturen
* Statistiken
* Zufallsgeneratorzustand

Speichervorgänge

Automatische Speicherung erfolgt:

* In regelmäßigen Abständen
* Nach wichtigen wirtschaftlichen Transaktionen
* Nach abgeschlossenen Aufträgen
* Bei relevanten Zustandsänderungen

Zusätzlich gibt es eine manuelle Speicherfunktion.

Speicherformat

Verwende ein versioniertes JSON-Format.

Beispiel:

interface SaveGame {
  version: number;
  savedAt: number;
  gameTime: number;
  economy: EconomyState;
  workshop: WorkshopState;
  workers: Worker[];
  vehicles: Vehicle[];
  orders: RepairOrder[];
  inventory: InventoryState;
  deliveries: Delivery[];
  customers: Customer[];
  statistics: GameStatistics;
}

Datenintegrität

Folgende Anforderungen gelten:

* Savegames vor dem Laden validieren
* Fehlerhafte Savegames abfangen
* Versionierte Migrationen unterstützen
* Speicherfehler behandeln
* Doppelte Finanzbuchungen verhindern
* Ungültige Auftragszustände erkennen
* Referenzen zwischen Aufträgen, Fahrzeugen und Mitarbeitern validieren

Speichergrenzen

localStorage besitzt eine begrenzte Speicherkapazität.

Deshalb:

* Keine Bilder oder Sprites im Savegame speichern
* Keine unbegrenzt wachsenden Ereignisprotokolle speichern
* Statische Definitionen nicht redundant speichern
* Stattdessen Referenzen über IDs verwenden
* Alte Statistikdaten bei Bedarf aggregieren

Export und Import

Implementiere:

* Spielstand als JSON exportieren
* Spielstand aus JSON importieren
* Spielstand zurücksetzen

Die Exportfunktion dient gleichzeitig als manuelle Datensicherung.

⸻

17. Datengetriebenes Design

Fahrzeuge, Reparaturen, Ersatzteile und Lieferanten sollen überwiegend über JSON-Definitionen konfigurierbar sein.

Beispiel: Reparaturdefinition

{
  "id": "replace_brake_pads",
  "name": "Bremsbeläge wechseln",
  "category": "brakes",
  "baseDurationMinutes": 90,
  "requiredSkill": "brakes",
  "minimumSkillLevel": 20,
  "requiredWorkstation": "lift",
  "requiredParts": [
    {
      "partId": "brake_pads",
      "quantity": 1
    }
  ],
  "steps": [
    {
      "id": "remove_wheels",
      "durationMinutes": 20
    },
    {
      "id": "replace_pads",
      "durationMinutes": 45,
      "dependsOn": ["remove_wheels"]
    },
    {
      "id": "mount_wheels",
      "durationMinutes": 25,
      "dependsOn": ["replace_pads"]
    }
  ]
}

Der Simulationskern muss diese Definitionen interpretieren können.

Neue Reparaturtypen sollen möglichst ohne Anpassungen an der Kernlogik ergänzt werden können.

⸻

18. Gameplay-Balancing

Beispielhafte Startwerte

* Startkapital: 25.000 €
* Mechaniker: 2
* Hebebühnen: 2
* Stundenverrechnungssatz: 85 €
* Startreputation: 50/100
* Kleine Auswahl an Ersatzteilen im Lager

Wirtschaftliche Herausforderungen

Der Spieler soll regelmäßig zwischen mehreren sinnvollen Möglichkeiten entscheiden müssen.

Beispiele:

Situation 1: Ersatzteilbeschaffung

Ein günstiger Lieferant benötigt zwei Tage. Ein teurer Lieferant liefert in einer Stunde.

Situation 2: Personalplanung

Ein zusätzlicher Mechaniker könnte mehr Aufträge bearbeiten, verursacht aber regelmäßige Kosten.

Situation 3: Investitionen

Eine neue Hebebühne erhöht die theoretische Kapazität, bringt jedoch keinen Nutzen ohne Personal und Aufträge.

Situation 4: Terminplanung

Ein umfangreicher Auftrag bietet eine hohe Marge, blockiert aber einen wichtigen Arbeitsplatz über längere Zeit.

Situation 5: Lagerhaltung

Ein großer Ersatzteilvorrat beschleunigt Reparaturen, bindet aber Kapital.

Balancing-Ziele

* Entscheidungen müssen wirtschaftlich spürbar sein.
* Gewinne dürfen nicht automatisch entstehen.
* Der Spieler soll gleichzeitig mehrere Probleme lösen müssen.
* Fehlentscheidungen dürfen Konsequenzen haben.
* Eine wirtschaftliche Erholung soll grundsätzlich möglich bleiben.
* Es darf keine erzwungene, künstliche Schwierigkeit durch unfaire Zufallsereignisse entstehen.

⸻

19. Entwicklungsphasen

Phase 1 – Spielbarer MVP

Ziel ist ein vollständig funktionierender Gameplay-Loop.

Enthalten sein müssen:

* Funktionierende 2D-Top-Down-Werkstatt
* Scrollen und Zoomen
* Zwei sichtbare Mitarbeiter
* Zwei Reparaturarbeitsplätze
* Ein Ersatzteillager
* Zehn Fahrzeugmodelle
* Mindestens 20 Reparaturdefinitionen
* Automatisch generierte Aufträge
* Auftragsannahme und Ablehnung
* Diagnose von Fahrzeugdefekten
* Ersatzteilbestellung
* Lieferzeiten
* Automatische Mitarbeiterbewegung
* Sichtbare Reparaturarbeiten
* Reparaturfortschritt
* Auftragsabschluss
* Abrechnung
* Einfaches Finanzdashboard
* Spielgeschwindigkeit
* Pause-Funktion
* Automatische Speicherung
* Savegame-Import und -Export

Der MVP muss tatsächlich spielbar sein.

Ein reines UI-Mockup oder eine nicht funktionierende Simulation erfüllt die Anforderungen nicht.

Phase 2 – Wirtschaft und Management

* Personalrekrutierung
* Mitarbeiterqualifikationen
* Weiterbildung
* Zusätzliche Lieferanten
* Automatische Lagerbestellungen
* Kundenreputation
* Detaillierte Finanzübersichten
* Werkstattausbau
* Unterschiedliche Kundenprofile
* Erweiterte Diagnosen

Phase 3 – Erweiterte Simulation

* Komplexe Fahrzeugdefekte
* Mehrere Mitarbeiter an einer Reparatur
* Zusätzliche Spezialwerkzeuge
* Qualitätsprobleme und Reklamationen
* Dynamische Marktpreise
* Kredite
* Werkstattflächen frei gestalten
* Zusätzliche Gebäudebereiche
* Erweiterte Personalverwaltung
* Umfangreiche Statistiken und Auswertungen

⸻

20. Qualitätssicherung

Automatisierte Tests

Verwende Vitest.

Mindestens folgende Bereiche müssen getestet werden:

* Auftragsstatus und Statusübergänge
* Diagnoselogik
* Reparaturvoraussetzungen
* Arbeitszeitberechnung
* Mitarbeiterzuweisung
* Lagerreservierungen
* Teileverbrauch
* Lieferungen
* Wirtschaftliche Berechnungen
* Finanzbuchungen
* Spielzeit
* Savegame-Serialisierung
* Savegame-Migration
* Importvalidierung

Zentrale Testfälle

Auftragsabschluss

Ein Auftrag darf nicht abgeschlossen werden, wenn erforderliche Reparaturen noch offen sind.

Ersatzteile

Ein Ersatzteil darf nicht mehrfach reserviert oder verbraucht werden, wenn der Bestand dafür nicht ausreicht.

Mitarbeiter

Ein Mitarbeiter darf nicht gleichzeitig zwei Aufgaben ausführen.

Arbeitsplätze

Ein Arbeitsplatz darf seine Kapazität nicht überschreiten.

Abrechnung

Ein Auftrag darf nicht mehrfach abgerechnet werden.

Spielzeit

Die Ergebnisse der Wirtschaftssimulation dürfen nicht von der Render-FPS abhängen.

Speichern und Laden

Ein gespeicherter Spielzustand muss nach dem Laden konsistent fortgesetzt werden können.

Codequalität

* TypeScript Strict Mode
* Keine unnötige Verwendung von any
* Klare Modulgrenzen
* Nachvollziehbare Zustandsautomaten
* Keine Geschäftslogik in Rendering-Komponenten
* Keine unnötigen externen Abhängigkeiten
* Kleine, verständliche Module
* Dokumentierte Datenformate
* Einheitliche Fehlerbehandlung

⸻

21. Wichtige Architekturentscheidungen

Simulation und Rendering trennen

Die Simulation ist die einzige autoritative Quelle des Spielzustands.

Der Renderer zeigt lediglich den aktuellen Zustand.

Animationen dürfen keine direkten wirtschaftlichen Transaktionen auslösen.

Ereignisbasierte Kommunikation

Wichtige Simulationsereignisse werden zentral verarbeitet.

Beispiele:

* order:created
* order:accepted
* diagnosis:completed
* parts:ordered
* parts:delivered
* repair:started
* repair:completed
* order:completed
* invoice:paid
* worker:available

Ereignisse dienen der Kommunikation zwischen Modulen und der Aktualisierung der Benutzeroberfläche.

Deterministische Simulation

Verwende einen kontrollierbaren Zufallsgenerator.

Die Simulation soll bei identischem Ausgangszustand, gleichem Seed und identischen Spieleraktionen reproduzierbare Ergebnisse erzeugen.

Dies erleichtert Tests und die Fehlersuche.

Aufgabenverwaltung

Die automatische Arbeitsplanung muss zentral erfolgen.

Die Zuweisung von Mitarbeitern, Arbeitsplätzen und Materialien muss atomar beziehungsweise konsistent durchgeführt werden.

Dadurch werden Doppelzuweisungen vermieden.

Wirtschaftsdaten

Geldbeträge werden als ganzzahlige Cent-Werte gespeichert.

Finanzielle Änderungen erfolgen ausschließlich über definierte Buchungsfunktionen.

Eine direkte Veränderung des Kontostands durch beliebige Module ist zu vermeiden.

⸻

22. Definition of Done für den MVP

Die erste Version gilt als vollständig, wenn folgender Ablauf ohne manuelle Eingriffe in die Daten funktioniert:

1. Neues Spiel starten.
2. Werkstatt mit zwei Mitarbeitern sehen.
3. Ersten Kundenauftrag erhalten.
4. Auftrag annehmen.
5. Fahrzeug in der Werkstatt sehen.
6. Mitarbeiter mit der Diagnose beauftragen.
7. Mitarbeiter sichtbar zum Fahrzeug laufen sehen.
8. Diagnose wird durchgeführt.
9. Defekt wird erkannt.
10. Reparatur wird geplant.
11. Benötigte Ersatzteile werden ermittelt.
12. Fehlende Ersatzteile können bestellt werden.
13. Lieferung trifft nach Ablauf der Lieferzeit ein.
14. Mitarbeiter holt benötigte Teile aus dem Lager.
15. Mitarbeiter führt die Reparatur sichtbar durch.
16. Reparaturfortschritt wird korrekt berechnet.
17. Qualitätskontrolle findet statt.
18. Auftrag wird abgeschlossen.
19. Rechnung wird erstellt und bezahlt.
20. Einnahmen und Kosten erscheinen korrekt im Finanzdashboard.
21. Ein weiterer Auftrag kann angenommen werden.
22. Mehrere Aufträge können parallel verwaltet werden.
23. Spielstand wird automatisch gespeichert.
24. Browser kann geschlossen und neu geöffnet werden.
25. Der letzte gespeicherte Spielzustand wird korrekt wiederhergestellt.

Die Kernsysteme müssen durch automatisierte Tests abgesichert sein.

⸻

23. Anweisungen für die Implementierung

Implementiere das Spiel schrittweise und modular.

Prioritäten

1. Funktionierende Simulation
2. Vollständiger Auftragsablauf
3. Wirtschaftliche Korrektheit
4. Sichtbare Mitarbeiter und Fahrzeuge
5. Benutzerfreundliche Oberfläche
6. Grafische Verbesserungen
7. Erweiterte Spielmechaniken

Wichtige Vorgaben

* Ausschließlich clientseitige Technologien einsetzen.
* TypeScript für sämtliche Spiellogik verwenden.
* Keine Backend-Abhängigkeit einführen.
* Keine serverseitige Datenbank verwenden.
* Alle Spielstände in localStorage speichern.
* Rendering und Geschäftslogik strikt trennen.
* Keine rein dekorativen UI-Funktionen ohne tatsächliche Implementierung.
* Spielmechaniken müssen im laufenden Spiel funktionieren.
* Reparaturen und Ersatzteile datengetrieben modellieren.
* Automatisierte Tests für zentrale Spiellogik erstellen.
* Spielstände müssen auch nach einem Browser-Neustart nutzbar sein.
* Die Anwendung muss nach dem Build statisch auslieferbar sein.
* Alle benötigten Assets müssen lokal verfügbar sein.
* Einfache, einheitliche 2D-Grafiken sind komplexen Grafiken vorzuziehen.
* Keine umfangreichen Frameworks einsetzen, wenn die Funktionalität mit TypeScript und PixiJS sauber umgesetzt werden kann.

Umsetzung

Beginne mit der grundlegenden Projektstruktur und dem Simulationskern.

Implementiere anschließend einen vollständigen vertikalen Gameplay-Durchlauf mit einem Fahrzeug, einer Diagnose, einer Ersatzteilbestellung und einer Reparatur.

Erweitere diesen anschließend auf mehrere Mitarbeiter, Fahrzeuge und Aufträge.

Baue erst danach die umfangreicheren wirtschaftlichen Systeme und die visuelle Ausgestaltung aus.

Das Ergebnis soll kein Prototyp aus statischen Oberflächen sein, sondern ein tatsächlich spielbares, wirtschaftlich nachvollziehbares Werkstattmanagement-Spiel, das vollständig im Browser läuft.