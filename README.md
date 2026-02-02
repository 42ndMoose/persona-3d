# Persona 3D (Local-first, no backend)

A browser-only, essay-based personality test UI:
- Three.js 3D quadrant visualization (CDN)
- Questions are scenario-driven (first-person roles)
- LLM does scoring and outputs strict JSON
- Site stores everything in localStorage (export/import supported)
- Adaptive question selection reduces fatigue by targeting uncertainty

## Run locally
Because ES modules + import maps require a local server (not file://):

### Option 1: Python
python -m http.server 8000

Open:
http://localhost:8000

### Option 2: Node (if you want)
npx serve

## Publish on GitHub Pages
1. Push this repo to GitHub (main branch).
2. Repo Settings -> Pages
3. Under Build and deployment -> Source: Deploy from a branch
4. Branch: main, folder: /(root)
5. Save

Your site will appear at:
https://YOUR-USER.github.io/YOUR-REPO/

## How to use
1. Click "Copy primer" and paste into your chosen LLM chat (once per session).
2. Click "Copy this question" and paste into the same chat, then write your essay answer.
3. Copy the model's JSON-only output and paste into the website.
4. Click "Parse + save".
5. Repeat.
