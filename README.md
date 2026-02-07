# Recipe Creator

Recipe Creator is a static React + TypeScript app for generating recipes from pantry items, building custom recipes, and sharing/exporting recipes without any backend.

## Highlights

- Pantry input with quick ingredient tags
- Preference controls: servings, max cook time, cuisine, dietary, allergens, equipment
- Recipe generation with:
  - 3-6 options
  - UK units (`g`, `kg`, `ml`, `litres`, `tbsp`, `tsp`)
  - ingredient scaling by servings
  - missing-ingredient detection
  - swap suggestions
- Recipe Builder:
  - create/edit recipes
  - ingredient unit dropdown
  - method steps with timers/notes
  - local storage persistence
- Import/Export/Share:
  - import recipe JSON
  - export recipe JSON
  - share link with recipe encoded in URL
- Accessibility and responsive layout basics

## Tech Stack

- Vite + React + TypeScript
- Plain CSS
- Vitest + React Testing Library
- GitHub Actions CI + GitHub Pages deploy

## Local Development

```bash
nvm use
npm install
npm run dev
```

## Quality Checks

```bash
npm run lint
npm run test:run
npm run build
```

## Deployment

Deployment is automated via `.github/workflows/deploy-pages.yml` on pushes to `main`.

After first push, ensure repository settings use:
- Pages source: GitHub Actions

Expected public URL format:

`https://<github-username>.github.io/<repository-name>/`
