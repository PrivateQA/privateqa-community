# fwkTest

Framework de tests E2E "agentique" **100% on-prem** (MVP).

## Objectif MVP

1. **Mapper** une UI cible (DOM interactif → "carte" locale).
2. **Compiler** un scénario en français (`.md`) → un test Playwright `.spec.ts`.
3. **Exécuter** les tests via Playwright (sans IA en runtime).

## Prérequis

- Node.js 20+
- (Optionnel) **Ollama** en local pour les embeddings: `nomic-embed-text`

## Démarrage rapide

Installer:

```bash
npm i
```

Mapper une page (génère `.fwkTest/map.json`):

```bash
npm run map -- https://example.com
```

Compiler un scénario markdown en spec Playwright:

```bash
npm run compile -- examples/demo.md
```

Compiler un cahier de tests (multi-cas) en plusieurs specs:

```bash
npm run compile -- cahier.md
# -> génère un dossier tests/generated/cahier/ avec 01-..., 02-..., etc.
```

Lancer les tests:

```bash
npm test
```

## Sorties d'exécution (non-régression)

Après un run, le dossier `test-output/` est généré:

- **`test-output/screenshots/success/`**: screenshot final des tests passés
- **`test-output/screenshots/failed/`**: screenshot final + screenshots “step-*” au moment de l’erreur
- **`test-output/logs/*.json`**: log détaillé par test (status, erreur, console, request failed, etc.)
- **`test-output/summary.json`** / **`test-output/summary.md`**: récapitulatif global
- **`test-output/run.jsonl`**: un enregistrement JSON par test (streamable)

## Notes (choix workflow)

- **Locators Playwright plutôt que CSS**: le mapper stocke d'abord des locators stables (`getByRole`, `getByTestId`, `getByText`) avant de tomber sur du CSS. Ça simplifie énormément l'auto-healing plus tard.
- **Store JSON local (MVP)**: rapide à mettre en place; on branchera ensuite SQLite/Chroma quand on voudra persister, versionner et requêter à grande échelle.

