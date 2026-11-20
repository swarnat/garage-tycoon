# Garage Tycoon

**▶ Jetzt spielen: https://swarnat.github.io/garage-tycoon/** (GitHub Pages, automatisch bei jedem Push auf `main`)
**📱 Mobile: https://swarnat.github.io/garage-tycoon/mobile.html** (eigene HTML, gleiche Simulation: Bottom-Nav, Fullscreen-Panels, Pinch-Zoom, Touch-Targets)

2D-Wirtschaftssimulation / Werkstattmanagement im Browser. TypeScript + Vite + PixiJS, vollständig offline. Spielstände werden primär in **IndexedDB** gespeichert (großer Browserspeicher, Fallback localStorage). Kein Backend.

![Screenshot](docs/screenshot.png)

## Spielen

Die jeweils aktuelle **`garage-tycoon.html`** aus dem [Release](../../releases/latest) herunterladen und im Browser öffnen – fertig. Keine Installation, kein Server nötig.

Alternativ lokal entwickeln:

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Vitest-Suite (50 Tests)
npm run build      # statischer Build nach dist/
npm run build:single  # eine einzelne HTML-Datei nach dist-single/
```

## Gameplay

Du führst eine Kfz-Werkstatt: Aufträge annehmen, Mitarbeiter diagnostizieren und reparieren lassen, Ersatzteile beschaffen, Rechnungen schreiben und die Werkstatt ausbauen. Die Mitarbeiter handeln autonom (A*-Wegfindung, Aufgabenplanung nach Qualifikation/Priorität/Termin); du übernimmst Planung und Wirtschaft.

- 13 Fahrzeugmodelle (inkl. Sportwagen), 25 datengetriebene Reparaturen, 144 Teile-Varianten in 25 Kategorien
- Diagnosesystem: Kundenmeldung ≠ tatsächliche Ursache
- Kostenvoranschläge mit Kundenfreigabe nach Budget und Kundenprofil
- Lager mit Reservierungen, drei Lieferanten (Standard / Express / Budget), **Auto-Nachbestellung** unter Mindestmenge (Lager als Modal), „Alle Auto AN/AUS"
- **Lager-Verbrauchsstatistik**: Spalten 24h/48h zeigen den Teileverbrauch je Artikel; Legende erklärt Markierungen (gelb = Bestand ≤ Mindestbestand)
- **Lockereres Lager-Management**: Start mit 1 je Standard-Variante (86) + Mindestbestand 1, Kapazität 160; Ein-Klick **„Verbrauchte Mengen nachbestellen"** (48h-Verbrauch aller Varianten gesammelt, abzüglich offener Lieferungen); Filter **„Verbrauch anzeigen"** (verbrauchte Varianten über alle Kategorien zentral); **höherwertige Alternative gleicher Größe** wird im Teile-Modal mit Preis vorgeschlagen (z. B. Premium statt fehlendem Standard). Auto-Nachbestellung bleibt bewusst AUS
- **Teilevarianten & Kompatibilität**: jedes Modell hat feste Specs (Reifengröße, Bremsscheibengröße, Öl-Spec, Batterie …); Diagnose löst Defekte auf konkrete Varianten auf; Qualitätsklassen Budget/Standard/Premium folgen dem Kundenprofil
- **Reifen & Felgen**: Reifenwechsel (4 Stück) und Felgenersatz brauchen die Reifenmontagemaschine (Ausbau); Felgen in Stahl/Alu/Premium-Alu je Größe
- **Teile-fehlt-Modal**: bei fehlendem Bestand nach der Diagnose – „Um Aufschub bitten & bestellen" (profilabhängige Akzeptanz-Chance, +6 h bis +1 Tag), „Ohne Aufschub bestellen" oder „Abweisen"; Express-Aufpreis zahlt die Werkstatt
- **Entscheidungs-Modals pausieren das Spiel** und sind minimierbar (Mini-Leiste, Spiel läuft weiter, Öffnen pausiert erneut)
- **Lager-Modal neu**: Kategorien-Navigation, Variantentabelle mit 24h/48h-Verbrauch, Letzte Bestellung, Ladenhüter-Badge + Verkauf zu 60 % Marktpreis, Sichtbarkeitsregel (0/0/0 ausgeblendet), Suche je Gruppe, Pin, „Alle Varianten"
- **Ereignisse mit Entscheidungen**: Hebebühnen-Defekt (Express vs. eigene Crew), Krankheit (Auskurieren vs. Halbtags), Lieferverzug (Express-Umleitung vs. Abwarten), Werkstatt-Inspektion (Vorbereiten/Bestechen/Ignorieren), öffentliche Beschwerde (Kulanz vs. Abwimmeln), Großauftrag (Annehmen/Ablehnen). Entscheidungs-Modal pausiert + minimierbar, ⚡-Button, Ablauf wählt automatisch die Standard-Option (max. 2/Tag)
- **Marketing**: 4 Level (0–300 €/Tag) bringen mehr und zahlungskräftigere Kunden
- **Tagesabschluss-Modal**: Umsatz, Gewinn, Aufträge, Ø Zufriedenheit, bester Mitarbeiter, Feedback
- **Juice**: steigende Geld-Beträge bei Rechnung, Tag/Nacht-Lichtstimmung, Defekt-Marker auf kaputten Bühnen, optionale WebAudio-Sounds (Rechnung/Auftrag/Ereignis, Toggle)
- **Mitarbeiter-Rollen**: Mechaniker (Reparatur/Diagnose/QC), **Lagerhelfer** (bringen Ersatzteile vom Lager zur Bühne – schnell zu Fuß, ab ca. 55 €/Tag; Mechaniker bleiben an der Bühne, ohne Lagerhelfer holen sie selbst) und **Assistent** (max. 1, sitzt im Büro, meldet stündlich Marktpreise ≥ 10 % unter Normal für relevante Varianten, je Variante max. 1 Meldung/Tag, ca. 60 €/Tag)
- **Termine**: alle Deadlines um 18:00 (Überfälligkeit erst zum Feierabend); Kleinaufträge nach 11 Uhr probabilistisch +1/+2 Tage, große Arbeiten 1–3 Tage
- **Personalverwaltung**: Kandidaten einstellen/entlassen (max. 6), **Weiterbildung** (+5 Skill für 150 €, 2 h)
- **Erweiterte Diagnosen**: unerfahrene Diagnostiker brauchen ggf. eine Nachuntersuchung
- **Spezialwerkzeuge** (Ausbau): Federspanner, Steuerzeiten-Werkzeug, Klimastation, Getriebeheber – bestimmte Reparaturen brauchen sie
- **Team-Reparaturen**: manche Jobs brauchen 2 Mitarbeiter (mit Team-Bonus); Fortschritt bleibt bei Wechsel erhalten
- **Qualität & Reklamationen**: QC kann fehlschlagen (Nacharbeit), schlechte Qualität führt zu Reklamationen (20 % Erstattung, Reputation −4)
- **Dynamische Marktpreise**: Teilepreise schwanken täglich ±15 % (Trendanzeige im Lager)
- **Kredite**: bis 50.000 € Schulden, 0,05 % Zinsen/Tag, manuelle Tilgung
- **Motivation**: steigt bei Erholung/Weiterbildung, sinkt bei Überlastung; beeinflusst Arbeitsgeschwindigkeit
- **Komplexe Defekte**: Folgeschäden (z. B. Wasserpumpe → Thermostat)
- **Statistik-Panel**: Reparaturen nach Typ, Mitarbeiter-Ranking, Qualität, Kostenstruktur
- **Stammkunden**: zufriedene Kunden (≥ 80) kommen mit 25 % Wahrscheinlichkeit wieder
- **Angebotsnachfrage**: droht ein Kunde abzulehnen, fragt das Spiel nach (Kundenhistorie, Rabatt 5/10/15 % oder Preis bestehen, 4-h-Frist)
- **Kalkulations-Ansicht**: Materialpositionen mit EK/VK, Arbeitszeit mit Lohnkosten, Diagnosepauschale, Rabatt und Gewinn je Auftrag
- **Tempo-Automatik**: nachts 8×, bei Auftragseingang und um 08:00 automatisch 1×
- **Laufgeschwindigkeit** als deutliches Mitarbeiter-Attribut (0.20–0.60, Kandidaten bringen eigenes Tempo mit)
- **Diagnose-Vorbereitung**: der beste Diagnostiker wartet an der Diagnose, wenn ein Fahrzeug auf Anfahrt ist
- Finanzsystem in Cent-Beträgen mit Doppelbuchungsschutz, Gehältern, Fixkosten, Dashboard mit Tagesübersicht
- Reputation, Kundenzufriedenheit, Terminplanung
- Ausbau: bis zu 4 Hebebühnen und 3 Diagnoseplätze, 8 Längs-Parkplätze (3 Start), Lagererweiterung, Spezialwerkzeuge
- Pause / 1× / 2× / 4× / 8× / 16× (nachts automatisch 16×), Autosave, Savegame-Export/-Import, versionierte Migrationen

## Architektur

Strikte Trennung von Simulation und Rendering:

- `src/core/` – Spieluhr (Fixed-Timestep), Event-Bus, deterministischer RNG, SaveManager
- `src/simulation/` – Aufträge, Mitarbeiter, Reparaturen, Diagnose, Lager, Lieferanten, Kunden, Wirtschaft
- `src/world/` – Tile-Grid, A*-Wegfindung, Arbeitsplätze
- `src/rendering/` – PixiJS-Renderer (zeigt nur den Zustand, keine Spiellogik)
- `src/assets/sprites/` – handgezeichnete SVG-Sprites (Mechaniker, Fahrzeug, Hebebühne, Diagnosepad, Lager, Tresen, Parkplatz, Automat) im Cartoon-Stil der Vorlagen
- `src/ui/` – DOM-Panels (Aufträge, Mitarbeiter, Lager, Finanzen, Ausbau, Einstellungen)
- `src/persistence/` – localStorage-Adapter, Savegame-Validierung und -Migration
- `src/data/` – JSON-Definitionen (Fahrzeuge, Teile, Reparaturen, Lieferanten)
- `tests/` – Vitest: Statusmaschine, Reservierungen, Buchungen, Determinismus, Save-Roundtrip u. v. m.

Das vollständige Spielkonzept liegt in [`konzept.md`](konzept.md). Umgesetzt sind Phase 1 (MVP), Phase 2 (Wirtschaft & Management) und der Großteil von Phase 3. Offen aus Phase 3: freie Flächenplanung, zusätzliche Gebäudebereiche, Krankheit/Überstunden.

## Releases

Bei jedem Versions-Tag (`v1.2.3` oder `1.2.3`) baut GitHub Actions automatisch:

1. `npm ci` + Tests
2. Single-File-Build (`garage-tycoon.html`)
3. Release mit der HTML-Datei als Asset

```bash
git tag v0.2.0
git push origin v0.2.0
```
