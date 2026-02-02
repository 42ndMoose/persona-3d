# Persona 3D (Local-first, no backend)

Browser-only, essay-based personality UI:
- Three.js quadrant plane with drag inertia + labels
- Scenario questions (first-person roles)
- LLM scores each answer independently and outputs strict JSON
- Effort points fill a 0..100 progress bar (can exceed 100)
- Buckets allow per-model tracking (e.g. "GPT-5.2 Thinking" vs "general")
- Persona card unlocks when a bucket reaches 100 points
- Export/import supported (JSON file)

## Run locally
Use a local server (modules need it):

python -m http.server 8000

Open:
http://localhost:8000

## GitHub Pages
Settings -> Pages -> Deploy from a branch -> main -> /(root)

## Images
- Question images: put files in `assets/questions/` named like `Q01.png`
- Preset avatars: put files in `assets/presets/` and list them in `assets/presets.json`
