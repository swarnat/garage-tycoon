# Konzept: Teilevarianten, Kompatibilität & Lager-Neubau (Entwurf v1)

Stand: von Grace freigegeben (v0.7.0), Entscheidungen:
- Kategorien = ALLE bisherigen Produkte (23) + Reifen + Felgen = 25.
- Felgen kaufbar in Stahl / Alu / Premium-Alu je Größe (= Qualitätsklassen).
- Aufschub profilabhängig; jedes Entscheidungs-Modal pausiert das Spiel und
  ist minimierbar (für Auslastungs-Check), Restore pausiert erneut.
- Express-Aufpreis zahlt die Werkstatt (bleibt in der Marge).
- Qualitätsklassen (budget/standard/premium) ab Phase A; Auflösung der
  Variante folgt dem Kundenprofil (preisbewusst→budget, qualität→premium). Ziel: reale Teilevielfalt
mit Größen/Specs, fahrzeuggenaue Kompatibilität, Reifen+felgen+Montagemaschine,
Nachfrage-Modal bei fehlenden Teilen (Aufschub vs. Abweisen), kategorisiertes
Lager-Modal mit Varianten-Sichtbarkeit, Letzte-Bestellung- und Verbrauchsanzeige.

## 1. Datenmodell

### Kategorien & Varianten
- `PartCategory` (neu, statisch in `src/data/categories.json`):
  Reifen, Felgen, Bremsen, Motor, Filter & Riemen, Elektrik, Fahrwerk,
  Flüssigkeiten, Getriebe, Klima, Abgasanlage, Karosserie.
- `PartVariant` (ersetzt das heutige `Part`):
  - `id`, `name`, `categoryId`
  - `spec` (Größen-/Typ-Schlüssel, z. B. `205/55R16`, `280mm`, `5W-30`, `60Ah`)
  - `buyCents`, `qualityClass` (budget/standard/premium – später)
  - `fitsSpecs: string[]` – ein Teil kann mehrere Specs bedienen
    (übergreifend nutzbar, z. B. Batterie 60Ah für Kompakt + Mittelklasse)
- ca. 12 Kategorien, 45–60 Varianten (3–6 je Kategorie). Startbestand deckt
  die häufigen Specs ab; seltene (Sport/Transporter) bewusst leer → das
  Nachfrage-Modal wird zum Lernmoment.

### Fahrzeug-Steckbrief
- Jedes Modell bekommt `partSpecs: Record<Kategorie, Spec>`:
  - Kleinwagen: Reifen 175/65R14, Bremsscheibe 240mm, Öl 5W-30, Batterie 45Ah …
  - Transporter: Reifen 215/65R16C (groß), Bremsscheibe 300mm, Öl 10W-40, 80Ah …
  - Sportwagen (neu, Klasse `sport`): Reifen 245/40R18 (breit), 320mm, 0W-40 …
- Alle Daten sind bei Ankunft bekannt → die benötigten Varianten stehen
  spätestens mit der Diagnose fest (deterministisch, kein Raten).
- Kompatibilitätsprüfung: `variante.fitsSpecs.includes(modell.partSpecs[kategorie])`.
  MVP: exakte Spec-Zuordnung; später Hersteller-/Baujahr-Feinregeln.

## 2. Reifen, Felgen & Montagemaschine

- Neue Kategorie **Reifen** (Größen 14–18 Zoll, Breite/Querschnitt als Spec)
  und **Felgen** (Zoll-Größe + Lochkreis vereinfacht als Spec).
- Neue Reparatur `tire_change` („Reifen erneuern“, 4 Stück):
  Schritte: Räder demontieren → alte Reifen von Felge trennen → neue Reifen
  aufziehen → auswuchten → Räder montieren → QC.
  - Benötigt **Reifenmontagemaschine** (neues Spezialwerkzeug im Ausbau,
    ~2.500 €). Fehlt sie → bestehendes Werkzeug-Modal.
  - Reifen werden 4× benötigt (Bestand/Reservierung mengenfähig, ist es schon).
- Felgen sind nur bei eigenem Defekt („Felge beschädigt“, selten) nötig;
  Reifenwechsel nutzt die vorhandenen Felgen weiter. Felgen-Varianten
  trotzdem im Katalog (Lagerhüter-Gefahr = gewolltes Planspiel).
- Defekt-Generator: Reifenverschleiß nach km/Alter; Sportwagen eher
  Bremsen/Reifen, Transporter eher Fahrwerk/Batterie.

## 3. Diagnose & Lagerprüfung (Ablauf)

1. Ankunft: Modell + Specs bekannt, Auftrag eingeholt.
2. Diagnose deckt Defekte auf → jeder Defekt wird auf die **konkrete Variante**
   aufgelöst (über `partSpecs` des Modells).
3. **Lagerprüfung** je Variante: verfügbar = Bestand − Reservierungen.
   - Alles da → normaler Kostenvoranschlag/Freigabe-Flow.
   - Etwas fehlt → **Nachfrage-Modal „Teile fehlen"** (einmalig pro Auftrag,
     Flag wie beim Werkzeug-Modal):
     - Zeigt: fehlende Varianten mit Spec, EK/VK, Lieferzeiten je Lieferant,
       Kundenprofil + Historie, Einschätzung („Kunde wirkt kulant").
     - Optionen:
       a) **„Um Aufschub bitten & bestellen"** – Kunde entscheidet (s. u.).
          Angenommen: Termin +1 Tag, Bestellung wird ausgelöst (Lieferant
          wählbar, Express-Option), Auftrag läuft weiter.
       b) **„Trotzdem bestellen (ohne Aufschub)"** – Termin bleibt, Risiko
          der Verspätung (−30 Zufriedenheit) trägt die Werkstatt.
       c) **„Abweisen"** – Auftrag storniert mit Grund, Reputation minimal −.
   - Bereits offene Lieferung für die Variante → kein Modal, nur ETA-Anzeige.
4. **Aufschub-Akzeptanz** (deterministisch über Seed-RNG):
   `chance = profilBasis + reputation/100*0.2 + (letzteZufriedenheit>=80 ? 0.1 : 0)`
   - Stammkunde 0.75, qualitätsorientiert 0.65, Geschäftskunde 0.55,
     preisbewusst 0.45, zeitkritisch 0.20; Clamp 0.05–0.95.
   - Abgelehnt → Kunde geht (Auftrag storniert) oder Option (b)/(c) greift.
5. Wartegrund im Fahrzeug-Detail nennt Variante + Spec + Liefer-ETA.

## 4. Lagerhaltung

- Bestand/Reservierung/Mindestbestand/Auto-Nachbestellung **pro Variante**
  (Mechanik bleibt, Schlüssel wird Varianten-ID).
- Neue Felder pro Variante im InventoryState:
  - `lastOrderedAtMinute` (letzte Bestellung – für Ladenhüter)
  - `pinned` (manuell eingeblendet, s. UI)
- Verbrauch kommt aus dem bestehenden `usageLog` (24h/48h), gefiltert nach
  Varianten-ID.
- **Ladenhüter-Erkennung**: Bestand > 0, Verbrauch 48h = 0, letzte Bestellung
  > 3 Tage her → Badge „Ladenhüter". Aktion **„Verkaufen"** (z. B. 60 % des
  aktuellen Marktpreises, Buchung als sonstiger Erlös) räumt Kapital frei.
- Kapazität bleibt global (Summe aller Varianten); Ausbau vergrößert.
- Migration alter Stände: generische Teil-IDs → Standard-Variante
  (z. B. `brake_pads` → `brake_pads_260`), Bestand/Min/Auto/usageLog werden
  übertragen; offene Bestellungen und Aufträge ebenso. Save-Version +1.

## 5. Lager-UI (neues Modal)

- Größeres Modal: `min(1200px, 96vw)`, Höhe ~92vh, zweispaltig.
- **Links**: Kategorienliste mit Bestands-Summe + globales Suchfeld.
- **Rechts**: Varianten-Tabelle der gewählten Kategorie:
  Name/Spec · Bestand · Reserviert · Min · Auto · EK/VK · 24h/48h ·
  **Letzte Bestellung** (relativ, z. B. „vor 2 Tagen") · Bestellen (+1/+5,
  Lieferant) · Ladenhüter-Badge · Verkauf-Button.
- **Sichtbarkeitsregel**: Varianten mit Bestand 0 UND Min 0 UND keiner offenen
  Bestellung UND nicht `pinned` werden ausgeblendet.
- **Suche je Gruppe**: Suchfeld blendet alle Treffer ein (auch versteckte);
  Toggle „Einblenden" setzt `pinned` persistent. Zusätzlich „Alle anzeigen"
  je Kategorie. So bleibt das Lager übersichtlich, aber jede Variante ist
  erreichbar und konfigurierbar.
- Gruppenkopf: Kategorie, Gesamtbestand, Σ Verbrauch 48h, „Alle Auto AN/AUS".
- Globale Lieferantenwahl + Auto-Regeln bleiben oben.
- Legende: gelb = ≤ Mindestbestand, Ladenhüter-Badge, Liefer-ETA-Symbol.

## 6. Balancing-Leitplanken

- Startlager deckt Kleinwagen/Kompakt/Mittelklasse ab → früher Spielfluss
  bleibt frei; Sport/Transporter erzwingen erste Bestell-Entscheidungen.
- Große/seltene Varianten: höherer EK, ähnliche Marge, längere Lieferzeit
  beim Budget-Lieferanten → Express-Abwägung wird real.
- Reifen: 4× Preis + ~60 min Arbeit; Maschine amortisiert sich über Reifensaison.
- Aufschub +1 Tag ist großzügig genug für Standardlieferung (8 h), knapp für
  Budget (24 h) → Lieferantwahl bleibt spannend.
- Keine unfairer Zufall: Specs deterministisch, Akzeptanzwürfel nur bei
  Aufschub-Anfrage (einmalig), keine versteckten Fehldiagnosen im MVP.

## 7. Umsetzungsphasen & Tests

- **Phase A – Daten & Fluss**: Kategorien/Varianten-Katalog, `partSpecs` je
  Modell, Kompatibilitätsauflösung in Diagnose, Lagerprüfung + Nachfrage-Modal
  (Aufschub/Bestellen/Abweisen), Migration. Tests: Kompatibilitäts-Matrix,
  Aufschub-Akzeptanz (Seed-deterministisch), Modal-Trigger einmalig,
  Migrations-Roundtrip.
- **Phase B – Lager-UI**: neues Modal (Kategorien, Suche, Sichtbarkeit,
  Letzte Bestellung, Ladenhüter, Verkauf). Tests: Sichtbarkeitsregel,
  pinned-Persistenz, Ladenhüter-Logik, Verkauf-Buchung (Cent, einmalig).
- **Phase C – Reifen & Maschine**: Reifen/Felgen-Varianten, Montagemaschine,
  `tire_change`-Reparatur mit 4× Verbrauch, Defekt-Gewichte je Klasse,
  Balancing. Tests: 4×-Reservierung/Verbrauch, Werkzeug-Gate, Größen-Zuordnung
  (Transporter ≠ Sport ≠ Kleinwagen).

## 8. Offene Punkte für Grace

1. Felgen sofort als eigene kaufbare Varianten, oder erst Reifen + Maschine
   (Felgen nur als seltener Defekt)?
2. Aufschub: pauschal +1 Tag, oder profilabhängig (zeitkritisch nur +6 h)?
3. Express-Aufpreis bei Aufschub-Bestellung: zahlt die Werkstatt (Marge weg)
   oder wird er dem Kunden aufgeschlagen (Budget-Risiko)?
4. Soll es Qualitätsklassen (budget/standard/premium) schon in Phase A geben,
   oder erst später als eigene Ausbaustufe?
