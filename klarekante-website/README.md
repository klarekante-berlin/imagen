# klarekante.berlin: 3 Website-Variants

Drei vollständige, klickbare HTML/CSS-Entwürfe nach dem Brief `klarekante-website-brief.md`. Kein Build-Schritt, keine Skripte, keine Webfonts, keine Cookies. Einfach `index.html` im Browser öffnen.

```
klarekante-website/
├── index.html        Übersicht und Vergleich der drei Variants
├── variant-a/        "Berlin Tageszeitung" (editorial, mittel laut)
├── variant-b/        "Punk Manifest" (brutalist, laut)
└── variant-c/        "Direkt & Sauber" (minimal, leise)
```

Jede Variant enthält dieselben 8 Seiten: `index.html` (Startseite), `geschichten.html` (Index), `beitrag.html` (Einzelbeitrag), `manifest.html`, `ueber-mich.html`, `kontakt.html`, `impressum.html` (inkl. Datenschutz), `404.html`.

Gemeinsame Grundlagen aller Variants:

- Light theme only, Kontrast WCAG AA oder besser
- Mobile-first, responsive ohne JavaScript
- Semantisches HTML, Skip-Link, Tastatur-Fokus-Styles, `aria-current` in der Navigation
- Meta-Description und Open-Graph-Tags auf jeder Seite
- System-Font-Stacks statt Webfont-Downloads (Performance, keine Drittanbieter-Requests)
- Kein Cookie-Banner, weil es nichts gibt, dem man zustimmen müsste. Die Datenschutzseite erklärt das ehrlich.
- Footer überall: Impressum, Datenschutz, Kontakt, Instagram, YouTube (Textlinks, keine Icons) und die Tagline "Ich mach's, weil's raus muss."
- Kein Em-Dash in irgendeinem Text
- Platz für Phase 2: Die Navigation hat maximal 4 Items, "Für Kids" kann als eigener Bereich mit eigener Optik dazukommen, ohne die Hauptnavigation zu sprengen.

Hinweis zur Inhaltslage: Die Begleitdokumente `klarekante-llm-briefing.md` und `klarekante-erste-outputs.md` liegen nicht im Repo. Die drei Über-mich-Absätze und die fünf Manifest-Punkte sind deshalb hier neu in Tonis Stimme geschrieben und als Platzhalter für die Originaltexte zu verstehen. Im Impressum stehen Platzhalter in eckigen Klammern.

---

## Variant A: "Berlin Tageszeitung"

**Begründung:** Diese Variant nimmt die Substanz der Marke ernst, indem sie sie wie Journalismus behandelt: Rubriken, Datumszeilen, Lead-Absätze, Drop-Cap, doppelte Trennlinien wie in einem Zeitungskopf. Sie betont Toni als Denker und Erzähler und gibt langen Headlines im Klare-Kante-Stil eine natürliche Bühne. Was sie unter den Tisch fallen lässt: die punkige, laute Seite der Marke. Sie riskiert, konventionell zu wirken, gewinnt dafür aber sofortige Glaubwürdigkeit bei Presse und Eltern.

**Typo-Stack**

| Rolle | Font-Stack | Größe |
|---|---|---|
| Body | Charter, Bitstream Charter, Source Serif 4, Georgia, serif | 18px / 1.65 |
| Headlines | Inter Tight, Inter, Helvetica Neue, Arial, sans-serif | 27px bis 43px, Gewicht 700/800 |
| Lead | Body-Serif | 19px bis 20px |
| Kicker/Datum | Grotesk | 13px, Versalien, gesperrt |

**Farben:** Hintergrund `#F8F5EF` (warmes Off-White), Text `#1A1814`, Sekundärtext `#4A453C`, Linien `#D8D2C4`, Akzent Kiosk-Rot `#C8362F` (Kicker, Drop-Cap, Hover, Zitat-Balken).

**Spacing:** Basis 8px. Listenelemente 22px vertikal, Abschnitte 32px, Artikel-Innenraum max. 44rem.

**Buttons:** Eckig, schwarz gefüllt mit hellem Text, Hover wechselt auf Rot. Nur eine Variante, sparsam eingesetzt.

**Links:** Dunkel mit roter Unterstreichung (2px), Hover färbt den Text rot.

**Layout-Besonderheiten:** Zwei Spalten ab 960px (Hauptspalte + Marginalien-Aside mit Über-mich-Teaser), einspaltig mobil. Drop-Cap im Artikel, Blockzitat mit rotem Balken.

---

## Variant B: "Punk Manifest"

**Begründung:** Diese Variant macht die Anti-Gloss-These zum Layout: harte 3px-Linien, Mono-Stempel wie `[001]` und `[Klartext]`, asymmetrisch versetzte Boxen, eine einzige laute Farbe als Textmarker. Nichts ist poliert, alles ist entschieden. Sie beweist den Anti-Influencer-Punkt, statt ihn zu behaupten, und gibt der Marke Selbstbewusstsein und Wiedererkennbarkeit. Was sie unter den Tisch fallen lässt: leise Vertrauensbildung. Für Eltern und Presse ist sie die anstrengendste der drei, dafür ist sie unkopierbar.

**Typo-Stack**

| Rolle | Font-Stack | Größe |
|---|---|---|
| Body | Helvetica Now, Helvetica Neue, Inter, Arial, sans-serif | 18px / 1.55 |
| Display/Headlines | gleiche Grotesk, Gewicht 800/900, enge Laufweite | 26px bis 88px |
| Stempel/Meta/Nav | ui-monospace, JetBrains Mono, IBM Plex Mono, Menlo | 12px bis 15px |

**Farben:** Hintergrund `#FFFFFF`, Text `#000000`, Sekundär `#555550`, Akzent Neon-Gelb `#F2FF00` (nur als Marker-Hintergrund: Hover, `<mark>`, Zitate, ein Wort in der Wortmarke).

**Spacing:** Bewusst ungleichmäßig. Boxen mit 3px-Rahmen und 20px Innenraum, auf Desktop abwechselnd 12 bis 18 Prozent ein- und ausgerückt.

**Buttons:** Eckig, 3px schwarzer Rahmen, Mono-Schrift. Zwei Varianten: outline und voll schwarz. Hover wird gelb. Sehen aus wie Buttons, nicht wie Pillen.

**Links:** Schwarz, dicke Unterstreichung (3px), Hover legt Neon-Gelb dahinter.

**Layout-Besonderheiten:** Index als Stempel-Liste (Mono links, Headline rechts), Pull-Quotes brechen auf Desktop aus der Lesespalte nach links aus, ironische Fußnote im Footer: "Geladen in 0.4s. Schneller als jeder Newsletter."

---

## Variant C: "Direkt & Sauber"

**Begründung:** Diese Variant nimmt den fünften Manifest-Punkt wörtlich: Wenn ein Element nichts sagt, fliegt es raus. Eine Spalte, ein Font, drei Nav-Items, 20px Body, viel Luft. Die Direktheit kommt aus den Texten und der Konsequenz im Weglassen, nicht aus Härte im Layout. Sie betont Vertrauenswürdigkeit und ist die beste Basis für den späteren Kids-Bereich, weil sie am wenigsten visuelle Konkurrenz macht. Was sie unter den Tisch fallen lässt: visuelle Wiedererkennbarkeit. Sie riskiert, zurückhaltend zu wirken, und steht und fällt mit der Qualität der Texte.

**Typo-Stack**

| Rolle | Font-Stack | Größe |
|---|---|---|
| Body | Inter, IBM Plex Sans, system-ui, Segoe UI, Arial, sans-serif | 20px / 1.7 |
| Headlines | gleicher Font, Gewicht 700, enge Laufweite | 27px bis 42px |
| Datum/Label | gleicher Font | 14px |

**Farben:** Hintergrund `#FBFAF6` (warmes Cream), Text `#21201C`, Sekundär `#5C594F`, Linien `#E4E1D6`, Akzent Backstein-Rot `#B2664E` (Links, Labels, Zitat-Balken, sonst nichts).

**Spacing:** Großzügig. Abschnitte 72px, Listeneinträge 26px, Lesespalte max. 42rem.

**Buttons:** Ein einziger Stil: dunkel gefüllt, 4px Radius, Hover Backstein-Rot. Kommt fast nie vor.

**Links:** Backstein-Rot mit feiner Unterstreichung, Hover wird dunkel.

**Layout-Besonderheiten:** Alles einspaltig. Index als ruhige Liste mit großen Headlines und kleinem Datum darunter. Über-mich: drei Absätze, kein Sidebar, kein Schnickschnack.

---

## UI-Copy in Tonis Stimme (alle Variants)

| Element | Text |
|---|---|
| Navigation | Geschichten · Manifest · Über mich · Kontakt (A, C) bzw. [Quatschen?] (B) |
| Footer-Tagline | Ich mach's, weil's raus muss. |
| 404 | Gibt's nicht. Vielleicht hat sich da jemand vertippt. Vielleicht ich. Geh zurück oder guck dich um. |
| Cookie-Hinweis | Es gibt keinen, weil nichts getrackt wird. Falls später doch etwas Zustimmungspflichtiges dazukommt: "Ich nutze hier nur Sachen, die wirklich nötig sind. Wenn du was anderes von mir willst: kannst du nicht bei mir kriegen." |
| Kontakt | Kein Formular, kein Ticket-System. Eine E-Mail reicht. |
| Submit-Button (falls später ein Formular kommt) | "Abschicken. Ich les das wirklich." |
| Datenschutz-Einstieg | Die Kurzfassung: Diese Seite trackt dich nicht. |

## Sanity-Check (Abschnitt 10 des Briefs)

1. Light theme: ja, alle drei. Kein Dark Mode, kein Toggle, kein `prefers-color-scheme`.
2. Keine Standard-Agentur-Optik: keine Hero-Slider, keine Pillen-Buttons-Parade, keine Feature-Grids.
3. UI-Texte in Tonis Voice: Navigation, 404, Fehlermeldungen, Footer, Datenschutz.
4. Em-Dash-frei: geprüft per Suche über alle Dateien.
5. Keine Stock-Imagery: es gibt gar keine Bilder. Die Über-mich-Seiten benennen den leeren Bildplatz ehrlich.
6. Kein Berufstitel: nirgends. Toni redet als Toni.
7. Kids-Bereich-Erweiterbarkeit: Navigation hat Luft für ein viertes/fünftes Item, eigener Unterordner mit eigenem Stylesheet ist im statischen Aufbau trivial.
8. Performance: pro Seite eine CSS-Datei unter 10 KB, keine Fonts, keine Bilder, keine Skripte. Lädt deutlich unter 1.5 Sekunden.

## Nächste Schritte (außerhalb dieses Briefs)

- Entscheidung für eine Variant, dann Umsetzung als Astro- oder Eleventy-Projekt mit Markdown-Content (wegen der KI-Automation-Pipeline)
- Echte Inhalte aus `klarekante-erste-outputs.md` einsetzen (Über-mich-Absätze, Manifest-Originaltexte)
- Impressums-Platzhalter füllen
- Eigenes, nicht inszeniertes Bild für Über-mich

---

# Runde 2: Magazin-Variants (D, E, F)

Auf Wunsch nach mehr Magazin-Charakter: drei neue Variants mit echten Bildern und Animationen. Die Bilder sind keine Platzhalter und keine Stockfotos, sondern eigene Illustrationen aus der klarekante-Bildwelt (`klarekante-style/` im Repo), zugeschnitten und als WebP komprimiert nach `klarekante-website/assets/` (12 Bilder, alle unter 250 KB).

Gemeinsame Technik der Magazin-Runde:

- Animationen: ein gemeinsames Mini-Skript `assets/reveal.js` (IntersectionObserver, 25 Zeilen) blendet Elemente mit der Klasse `anim` beim Scrollen ein. Ohne JavaScript bleibt alles sichtbar, bei `prefers-reduced-motion: reduce` wird jede Bewegung abgeschaltet (auch Laufband, Ken Burns, Schweben).
- Bilder mit `width`/`height` gegen Layout-Shift, `loading="lazy"` unterhalb des Folds, beschreibende deutsche Alt-Texte mit Präfix "Illustration:".
- Open-Graph-Bild auf Seiten mit Aufmacher.
- Sonst wie Runde 1: light only, System-Fonts, kein Tracking, kein Cookie-Banner, Berliner Schnauze.

## Variant D: "Kiez-Magazin"

**Begründung:** Nimmt die Tageszeitungs-Idee aus Runde 1 und macht ein echtes Magazin daraus: Cover mit langsamem Ken-Burns-Zoom, eine Aufmacher-Karte, die ins Bild ragt, Rubrik-Karten mit Hover-Zoom, Drop-Cap und Bildunterschriften, die Haltung zeigen ("Sieht ordentlich aus. Hält genau bis zum Frühstück."). Toni als Erzähler mit Bildredaktion. Risiko: am konventionellsten der drei.

- **Farben:** Papier `#F7F2E9`, Karten `#FFFDF8`, Text `#1F1A14`, Akzent Kiosk-Rot `#C8362F`
- **Typo:** Charter/Georgia für Headlines und Body, Grotesk für Kicker, Datum, Nav (Versalien, gesperrt)
- **Layout:** Cover 16:9, Karten-Raster 1/2/3-spaltig, Index als Bild-plus-Text-Liste, Lesespalte 46rem
- **Animation:** Ken Burns auf dem Cover (24s), Scroll-Reveals, Bild-Zoom beim Hover, animierte Nav-Unterstreichung

## Variant E: "Bunte Beilage"

**Begründung:** Die lauteste Variant und die mit der größten Nähe zur Instagram-Bildwelt: Laufband oben ("Kein Newsletter-Popup +++ Kein Funnel +++ Kein Coach"), schwebender Sofa-Chaos-Held, schiefe Polaroid-Karten mit hartem Schlagschatten, Sticker-Badges, Pillen-Nav mit Kipp-Effekt. Der Anti-Gloss-Punkt wird hier mit Humor bewiesen statt mit Härte. Risiko: kann kindlich wirken, ist dafür unverwechselbar und trägt den späteren Kids-Bereich am natürlichsten.

- **Farben:** Cream `#FBF3E4`, Text `#2B2014`, Orange `#E8590C`, Gelb `#F5C518`, Blau `#2D6E8E` (Sticker)
- **Typo:** eine Grotesk durchgehend, Gewichte 600 bis 900, Marker-Hintergrund im Held
- **Layout:** Held zweispaltig, Polaroid-Raster, Manifest als gestapelte schiefe Karten mit Nummern-Buttons
- **Animation:** CSS-Laufband (28s Loop), Schwebe-Animation des Helden, Polaroids richten sich beim Hover auf, federnde Reveals (cubic-bezier mit Überschwingen)

## Variant F: "Studio-Magazin"

**Begründung:** Das ruhige, moderne Magazin: strenges Raster, nummerierte Beiträge (001, 002), Bildunterschriften mit feiner Trennlinie, Sticky-Header mit Blur, Lesefortschritts-Balken im Artikel (CSS scroll-timeline, ohne JavaScript). Bilder leicht entsättigt, erst beim Hover in voller Farbe: Zurückhaltung als Stilmittel. Wirkt am professionellsten gegenüber Presse und Eltern. Risiko: am wenigsten "Berliner Schnauze" im Visuellen, die Stimme muss aus den Texten kommen.

- **Farben:** `#FAFAF7`, Text `#1C1C1A`, Akzent Mauer-Blau `#6F8896` / `#4D6877`
- **Typo:** eine Sans durchgehend, 19px Body, tabellarische Ziffern für Nummern
- **Layout:** Held zweispaltig mit Caption, Raster 3-spaltig, Index als Nummer-Bild-Text-Zeilen, Lesespalte 42rem
- **Animation:** sanfte Reveals mit Stagger, Hover-Zoom plus Sättigung, Sticky-Header, Lesefortschritt nur in Browsern mit scroll-timeline

## Asset-Verzeichnis

| Datei | Quelle in klarekante-style/ | Verwendung |
|---|---|---|
| hero-chaos.webp | 3d-animated-style-illustr (Sofa-Chaos, mit Alpha) | Held E, Artikelbild, Karten |
| toni-portrait.webp | papa/character-sheet (Daumen-hoch-Pose) | Über mich, Teaser |
| familie-auto.webp | 3d-a-family-of-five (Kombi) | Karten |
| roadtrip-kueste.webp | umgebungen/enivornment-sheet (Küstenpanel) | Held F |
| berlin-panorama.webp, -alexanderplatz, -eastside, -reichstag, -ubahn, -currywurst | umgebungen/environment-sheet Berlin (Einzelpanels) | Cover D, Rubriken, 404 |
| plan-notizbuch.webp, postkarte.webp | items/multiple-elements (Einzelobjekte) | Artikelbild, Karten |
