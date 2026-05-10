# Imagen V3 – World-Building Production Stack

Imagen V3 ist ein format-agnostischer, editierbarer Produktions-Stack für visuelles World-Building. Es verwandelt Skripte (z.B. aus Obsidian) in konsistente visuelle Welten – egal ob für Instagram-Carousels, Buchcover oder Mockumentaries.

Die V3-Architektur löst die starren Hardcodierungen der Vorgängerversionen auf und führt echtes semantisches Retrieval (Multimodal RAG) sowie eine robuste Job-Queue ein.

---

## 🚀 Features der V3-Architektur

*   **Format-Agnostisches Projekt-System:** Keine hardcodierten Stile mehr. Jedes Projekt definiert sein eigenes Format (z.B. 16:9), seine erlaubten Asset-Kategorien und seine System-Prompts.
*   **Turso / libSQL:** Schnelle, lokale SQLite-Datenbank für Entwicklung, nahtlos skalierbar auf Turso in Produktion.
*   **Multimodal RAG (Voyage AI):** Assets werden nicht mehr über starre Text-Tags gesucht. Voyage AI (`voyage-multimodal-3.5`) versteht Text und Bild im selben semantischen Raum. Ein Prompt wie "Toni im Regen" findet das passende Bild, auch wenn "Regen" kein Tag ist.
*   **Inngest Job-Queue:** Bildgenerierung läuft asynchron im Hintergrund. Mit automatischen Retries, Concurrency-Limits und sauberem State-Management.
*   **Atlas Cloud Limit-Bypass:** Nutzt bis zu 10 Referenzbilder beim GPT Image 2 Edit-Endpoint für komplexe Szenen mit mehreren Charakteren und Style-Anchors.

---

## 🛠️ Lokales Setup & Installation

### 1. Voraussetzungen
*   Node.js (v22+)
*   pnpm (`npm install -g pnpm`)
*   API-Keys für Anthropic, OpenAI, Atlas Cloud und Voyage AI

### 2. Repository klonen & Abhängigkeiten installieren
```bash
git clone https://github.com/klarekante-berlin/imagen.git
cd imagen
git checkout v3-architecture
pnpm install
```

### 3. Umgebungsvariablen konfigurieren
Kopiere die `.env.example` zu `.env` und fülle die Keys aus:
```bash
cp .env.example .env
```

**Wichtige Variablen für V3:**
*   `ANTHROPIC_API_KEY`: Für Story-Planung und Szenen-Extraktion
*   `OPENAI_API_KEY`: Für GPT Image 2 Bildgenerierung
*   `ATLASCLOUD_API_KEY`: Für GPT Image 2 Edit-Endpoint (Inpainting)
*   `VOYAGE_API_KEY`: Für Multimodal RAG (Embeddings)
*   `INNGEST_DEV=true`: Setze dies auf `true`, wenn du *ohne* separaten Inngest-Server arbeiten willst (Bilder werden dann synchron generiert).

### 4. Datenbank & Seed (One-Click Setup)
Führe diesen Befehl aus, um die lokale SQLite-Datenbank (`storage-data/imagen.db`) zu erstellen, die Tabellen anzulegen und das Default-Projekt sowie 2 Style-Assets zu seeden:

```bash
pnpm db:setup
```
*(Dieser Schritt führt keine API-Calls aus und kostet keine Tokens).*

---

## 🏃‍♂️ App starten

Du hast zwei Möglichkeiten, die App lokal zu starten:

### Option A: Einfacher Modus (Synchron)
Wenn du `INNGEST_DEV=true` in deiner `.env` gesetzt hast, kannst du die App einfach so starten. Die Bildgenerierung blockiert den Request nicht, sondern läuft inline im Hintergrund.

```bash
pnpm dev
```

### Option B: Full-Stack Modus (Asynchron mit Job-Queue)
Wenn du die echte asynchrone Job-Queue testen willst (empfohlen):
1. Setze `INNGEST_DEV=false` (oder entferne es) in der `.env`.
2. Starte App und Inngest Dev-Server parallel:

```bash
pnpm dev:full
```
Die App läuft auf `http://localhost:3000`, das Inngest Dashboard auf `http://localhost:8288`.

---

## 🧠 Multimodal RAG: Embeddings generieren

Wenn du neue Assets über die UI hochlädst, werden sie automatisch vektorisiert. 
Wenn du bestehende Assets hast (z.B. nach einem manuellen Import), musst du deren Embeddings einmalig generieren lassen:

**Über die UI:**
Gehe auf die "Library"-Seite und klicke oben rechts auf **"Embeddings auffrischen"**.

**Über die CLI:**
```bash
# Zeigt an, wie viele Assets ein Embedding brauchen (ohne API-Call)
pnpm embed:backfill --dry-run

# Führt den Backfill aus (Batch-Size 5, 1 Sekunde Delay)
pnpm embed:backfill
```

---

## 🏗️ Architektur-Überblick

*   **Frontend:** React, Vite, TailwindCSS, tRPC, Wouter
*   **Backend:** Express, tRPC, Drizzle ORM
*   **Datenbank:** libSQL (lokal) / Turso (Produktion)
*   **Job-Queue:** Inngest
*   **AI-Modelle:** Claude 3.5 Sonnet (Planung), GPT Image 2 (Generierung), Voyage Multimodal 3.5 (Retrieval)
