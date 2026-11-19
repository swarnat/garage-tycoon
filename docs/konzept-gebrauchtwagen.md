# Konzept: Gebrauchtwagen-Ankauf & Verkauf (nächster Step, zur Absegnung)

Status: **dokumentiert, noch nicht implementiert** (Grace: „erstmal im nächsten Step, aber dokumentieren").
Ziel: zweiter Profit-Loop neben dem Kundenauftrag – aktiv handeln statt nur abwarten.

## Grundidee
Der Spieler kauft günstige Gebrauchtwagen mit Defekten, repariert sie mit der
bestehenden Crew (Diagnose → Teile → Reparatur → QC) und verkauft sie mit Gewinn.
Alles wird wiederverwendet, was schon existiert: Fahrzeugmodelle, Teilevarianten,
Kompatibilität, Reparatur-Definitionen, Qualitätskontrolle, Marktpreise.

## Ankauf
- Neuer Bereich **„Ankauf"** (Sidebar-Panel) mit 3–5 wechselnden Angeboten,
  Refresh alle 1–2 Tage (wie Kandidatenpool).
- Angebot: Modell, Baujahr, km-Stand, **sichtbare Mängel-Liste** (bekannte Defekte,
  Reparatur-IDs), askingPrice, geschätzter Marktwert (heile).
- Preisformel: `marktwert(heile) × zustandsfaktor − Reparaturkosten-Schätzung × risikoabschlag`.
  Zustand aus km/Alter/Defektanzahl. Versteckte Defekte: ein Teil der Mängel ist
  erst nach der Diagnose sichtbar (Risiko!).
- Kauf = Buchung `investment`, Fahrzeug erscheint auf einem Parkplatz als
  `owned`-Fahrzeug (eigener Besitz, kein Kundenauftrag).

## Reparatur
- Owned-Fahrzeuge throughlaufen denselben Diagnose-/Reparatur-Flow, aber:
  - Kein Kundenbudget/keine Genehmigung – der Spieler entscheidet selbst.
  - Teile werden aus dem Lager verbraucht (Bestand muss passen oder bestellt werden).
  - QC wie gehabt; Qualität beeinflusst den späteren Verkaufspreis.
- Priorität: Kundenaufträge haben Vorrang vor Owned-Reparaturen (oder per
  Prioritäts-Flag steuerbar), damit das Kerngeschäft nicht leidet.

## Verkauf
- Nach Reparatur (oder auch unrepariert „wie gesehen") → **Verkauf-Panel**.
- Verkaufspreis = `marktwert(heile) × qualitätsfaktor × altersfaktor − mangelabschlag`,
  plus kleiner Verhandlungs-Spielraum (Käufer bietet, annehmen/ablehnen).
- Ladenhüter-Risiko: steht das Auto zu lange, sinkt der Preis langsam (Standkosten).
- Verkauf = Buchung `revenue`, Fahrzeug verlässt die Werkstatt.

## Risiko & Balance
- Fehlkalkulation: versteckte Defekte + teileintensive Reparaturen können den
  Gewinn auffressen. Marktpreise (±15 %) beeinflussen An- und Verkauf.
- Kapitalbindung: Ankauf bindet Liquidität (Kredite werden relevanter).
- Begrenzung: max. 3–4 Owned-Fahrzeuge gleichzeitig (Parkplatz-/Kapazitätsdruck).

## Datenmodell (Skizze)
- `OwnedVehicle`: id, modelId, year, mileageKm, knownDefects[], hiddenDefects[],
  purchaseCents, qualityScore, status (`bought|diagnosing|repairing|ready|listed|sold`),
  listedAtMinute, askingCents.
- `UsedCarOffer`: id, modelId, year, mileageKm, visibleDefects[], hiddenCount,
  askingCents, fairValueCents, expiresAtMinute.
- GameState: `usedCarOffers[]`, `ownedVehicles[]`, `nextUsedCarRefreshDay`.
- Migration: neue Felder leer initialisieren.

## UI
- Panel „Ankauf" (Angebote) + „Verkauf" (eigene Fahrzeuge).
- Owned-Fahrzeuge im Canvas mit anderem Farbton / „EIGEN"-Badge.
- Kalkulations-Tooltip: Einkauf + Reparaturkosten + erwarteter Erlös = Marge.

## Tests (TDD)
- Preisformel deterministisch (Seed), versteckte Defekte erst nach Diagnose.
- Kauf/Verkauf-Buchungen integer-cent, doppelbuchungssicher.
- Reparatur-Flow für Owned ohne Kundengenehmigung, QC beeinflusst Verkaufspreis.
- Ladenhüter-Preisverfall, Kapazitätsgrenze, Migration.

## Aufwand
Mittel–hoch. Wiederverwendung hoch (Repair/Inventory/QC/Market existieren).
Neu: Offer-Generierung, Owned-Statusmaschine, Verkauf-Verhandlung, 2 Panels,
Canvas-Darstellung, Migration. Grob 1–2 Patch-Runden.
