# Recipe Creator - LLM Edition

Recipe Creator is now an AI-powered static web app that generates recipes dynamically from an LLM based on your pantry, constraints, and follow-up prompts.

Live URL: https://pruleaf-cell.github.io/recipe-creator/

## What is new

- Dynamic recipe generation with an LLM (OpenAI-compatible endpoint)
- Prompt studio with creativity control and recipe count dial
- Follow-up refinement for selected recipes
- Interactive recipe cards with:
  - Pantry-fit scoring
  - Missing ingredients
  - Swap suggestions
  - Servings scaling
  - In-place ingredient and method editing
- Cook mode with step navigation and optional timers
- Recipe comparison panel
- Local cookbook with import/export
- Shareable recipe links (recipe encoded in URL)

## UK-first cooking defaults

- Units: `g`, `kg`, `ml`, `litres`, `tbsp`, `tsp`
- Oven instructions requested in Celsius + Gas Mark
- Dietary and allergen constraints honored in prompts and post-processing

## Stack

- Vite + React + TypeScript
- Vitest + React Testing Library
- GitHub Actions CI + GitHub Pages deployment

## Local development

```bash
nvm use
npm install
npm run dev
```

## Run checks

```bash
npm run lint
npm run test:run
npm run build
```

## LLM configuration

The app runs fully in-browser and supports static hosting (GitHub Pages). To use dynamic AI generation:

1. Open the app.
2. Enter your API key in the `LLM Engine` panel.
3. Optional: set a custom model or endpoint.

If no API key is provided, the app falls back to an offline built-in recipe library.

## Deployment

- CI workflow: `.github/workflows/ci.yml`
- Pages workflow: `.github/workflows/deploy-pages.yml`
- Pages source: GitHub Actions
