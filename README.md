# Prima – CMMS für Industrieanlagen

Progressive Web App für Wartung, Störungsmeldungen und Abnahmen.
React + Vite, Tailwind CSS, Lucide Icons, Supabase (Datenbank, Auth, Storage).

## Inbetriebnahme

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Produktionsbuild in dist/
```

Die `.env` ist mit dem Supabase-Projekt befüllt.

## Datenbank einrichten oder aktualisieren

`supabase/schema.sql` im Supabase **SQL-Editor** vollständig ausführen.

* Das Skript ist **idempotent**: Es funktioniert auf einer leeren Datenbank und auf
  dem bestehenden Stand, beliebig oft, **ohne Daten zu löschen**.
* Es ergänzt bei bestehenden Installationen die neuen Spalten und ENUM-Werte
  (Grund der Störung, Reparaturzeit), übernimmt alte Freitext-Störungsgründe in die
  Auswahl und lädt das API-Schema neu.
* Fehlt das Update, blendet die App oben einen gelben Hinweis ein, statt mit
  kryptischen Fehlern zu antworten.

Optional `supabase/seed.sql` für Beispielstruktur ausführen. Zum Testen des
Vier-Augen-Prinzips zwei Konten anlegen (eines *Technik*, eines *QM*).

## Änderungen in dieser Version

* **Übersicht:** Kacheln führen in eigene, strikt gefilterte Ansichten
  (*Offen*, *In Bearbeitung*, *Fertig zur Abnahme*, *Ausfallzeit gesamt*).
  Der Bereich „Anstehende Wartungszyklen“ ist entfernt.
* **Aufträge:** Reiter *Offen · In Bearbeitung · Zur Abnahme · Störungen · Wartungen · Archiv*.
  Abnahmebereite Aufträge erscheinen nicht mehr in den aktiven Listen, sondern im
  eigenen Reiter mit Freigabe und Beanstandung.
* **Archiv:** getrennt in *Geplante Wartungen* und *Ungeplante Störungen*.
* **Reparaturzeit:** Ein Datenbank-Trigger speichert Start- und Endzeitpunkt und
  addiert die Dauer (auch über mehrere Durchläufe nach einer Beanstandung).
  Die Auftragsseite zeigt eine laufende Stoppuhr, die Gesamtdauer und einen Richtwert
  aus früheren Aufträgen derselben Maschine.
* **Zeitformat:** Unter einer Stunde in Minuten („3 Minuten“), darüber „1 Std. 20 Min.“.
  Diagramme wechseln automatisch zwischen Minuten- und Stundenachse, Balken haben ein
  Mindestmaß und tragen ihre genaue Dauer als Beschriftung.
* **Grund der Störung:** Auswahlfeld (ENUM `fault_cause_kind`) bei Erstellung,
  Bearbeitung und Fertigmeldung; Pflicht bei Stillstand. Neue Auswertung als
  Kreisdiagramm mit Tabelle sowie als Pareto-Diagramm unter *Berichte*.
* **Maschinenakte:** neuer Reiter *Ersatzteil-Historie* (Datum, Ersatzteile, Arbeitsauftrag,
  Techniker), direkt aus `work_orders` abgefragt, ohne eigene Tabelle.

## Vier-Augen-Prinzip

| Ebene | Wirkung |
|---|---|
| Oberfläche | Freigeben und Beanstanden sind für die Person gesperrt, die den Auftrag fertig gemeldet hat. |
| Datenbank-Trigger `enforce_four_eyes` | Weist Abnahme und Beanstandung durch dieselbe Person ab. Eine Beanstandung braucht zwingend eine Notiz. |

## Hinweise zum Betrieb

* **Fällige Wartungen** werden beim Öffnen der App still im Hintergrund als Aufträge
  angelegt (höchstens einmal pro Stunde, ohne Duplikate).
* **Zeiterfassung:** Die Zeitfelder setzt ausschließlich der Datenbank-Trigger; angemeldete
  Benutzer können sie nicht direkt überschreiben.
* **Ausfallzeit** endet spätestens mit der Abnahme des Auftrags.
* **Sicherheit:** Die Views `machines_due` und `v_downtime` respektieren die Zugriffsregeln der
  Tabellen und sind für nicht angemeldete Zugriffe gesperrt; die Funktionen
  `generate_due_maintenance` und `copy_checklist` sind nur für angemeldete Benutzer aufrufbar.
* **Installation als App:** über HTTPS (oder `localhost`) in Chrome/Edge über das
  Installationssymbol, auf Android über „App installieren“, auf iOS über
  „Teilen ➔ Zum Home-Bildschirm“.
