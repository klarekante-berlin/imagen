# Imagen – Story Carousel Generator TODO

## Database & Backend
- [x] DB Schema: assets table (character sheets, environments, vehicles, items)
- [x] DB Schema: stories table (theme, consistency_context, model, status)
- [x] DB Schema: slides table (story_id, slide_number, prompt, image_url, image_key, text_content)
- [x] DB push migrations
- [x] tRPC router: assets (list, upload, delete, categorize)
- [x] tRPC router: stories (create, list, get, delete, duplicate)
- [x] tRPC router: slides (generate, regenerate, list by story)
- [x] tRPC router: generate (story text via Claude, images via gpt-image-2)
- [x] tRPC router: export (getExportData)
- [x] Claude Sonnet/Opus integration for story text generation
- [x] OpenAI gpt-image-2 API integration for image generation
- [x] Freepik API integration as alternative image provider
- [x] Consistency engine: lock outfits/environments/characters per story
- [x] Character auto-detection from story text
- [x] ZIP export via jszip in frontend

## Frontend – Layout & Design
- [x] Dark theme design system (index.css, fonts, color palette)
- [x] AppLayout with sidebar navigation
- [x] Sidebar nav: Library, Story Generator, Archive
- [x] Responsive layout (mobile-first)

## Frontend – Character Library (Feature 1)
- [x] Asset grid view with category filter tabs
- [x] Categories: Familie, Historisch, Sport, Musik, Politiker, Tech-CEOs, Tiere, Umgebungen, Fahrzeuge
- [x] Asset card with preview image, name, category badge
- [x] Asset detail modal with full character sheet view
- [x] Search/filter functionality

## Frontend – Asset Upload (Feature 8)
- [x] Drag-and-drop upload zone
- [x] Category assignment on upload
- [x] Name/description input for new assets
- [x] Upload progress indicator

## Frontend – Story Generator (Features 2, 3, 4)
- [x] Theme input form (textarea + character selector)
- [x] Model selector (Claude Sonnet / Claude Opus)
- [x] Format selector (1:1 / 4:5)
- [x] Image provider selector (gpt-image-2 / Freepik)
- [x] Character selection from library for story
- [x] Consistency context display (outfits, environment locked)

## Frontend – Image Generation & Carousel (Features 5, 6)
- [x] Image generation trigger per story
- [x] Per-slide image generation with progress
- [x] Carousel preview in Instagram format (1:1 / 4:5)
- [x] Individual slide regeneration button
- [x] Slide text overlay display
- [x] Auto-refresh while generating

## Frontend – Export (Feature 7)
- [x] ZIP download button for all 10 slides
- [x] Individual slide download

## Frontend – Story Archive (Feature 10)
- [x] Story list with date, theme, status
- [x] Story detail view with all slides
- [x] Duplicate story button
- [x] Delete story with confirmation
- [x] Status badges (draft, generating, complete, error)

## Testing
- [x] Vitest: API key configuration tests
- [x] Vitest: asset CRUD procedures (mocked)
- [x] Vitest: story creation procedure (mocked)
- [x] Vitest: auth procedures
- [x] 16/16 tests passing

## Deployment
- [x] Secrets configured (OPENAI_API_KEY, ANTHROPIC_API_KEY, FREEPIK_API_KEY)
- [x] 141 assets seeded into database from character sheets
- [ ] GitHub push to klarekante-berlin/imagen
- [ ] Checkpoint saved and published
