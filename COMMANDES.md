# fwkTest - Guide des commandes

## Workflow classique (3 etapes)

```bash
# 1. Mapper l'application cible (genere .fwkTest/map.json)
npm run map -- https://mon-app.com

# 2. Compiler le scenario .md en test Playwright (.spec.ts)
npm run compile -- scenario.md

# 3. Lancer les tests
npm test
```

C'est tout. Apres l'etape 3, les resultats sont dans `test-output/`.

---

## Detail des commandes

### Map - Scanner l'UI cible

```bash
npm run map -- <url>
```

Options :
- `--out <chemin>` : chemin du fichier map (defaut: `.fwkTest/map.json`)
- `--no-embeddings` : desactiver les embeddings Ollama (plus rapide, pas besoin d'Ollama)
- `--headed` : lancer le navigateur en mode visible
- `--max <n>` : nombre max d'elements extraits (defaut: 200)

### Compile - Generer le .spec.ts

```bash
npm run compile -- <scenario.md>
```

Options :
- `--map <chemin>` : chemin de la map (defaut: `.fwkTest/map.json`)
- `--out <chemin>` : chemin du fichier ou dossier de sortie
- `--preprocess` : activer le pre-traitement IA (normalisation des steps via LLM)
- `--no-ai` : forcer le mode heuristique uniquement (sans Ollama)
- `--gen-model <nom>` : modele LLM pour la generation (defaut: `mistral`)

### Preprocess (optionnel) - Normaliser le scenario via IA

```bash
npm run preprocess -- <scenario.md>
```

Options :
- `--out <chemin>` : chemin du pivot JSON (defaut: `.fwkTest/pivot.json`)
- `--no-ai` : utiliser uniquement le parser heuristique
- `--model <nom>` : modele LLM (defaut: `mistral`)

### Run - Executer les tests

```bash
npm test                    # mode headless (par defaut)
npm run run -- --headed     # mode visible (navigateur affiche)
```

### Report - Re-generer le rapport HTML

```bash
npm run report
```

### Evolution - Rapport d'evolution multi-runs

```bash
npm run evolution
```

### API - Demarrer le serveur HTTP

```bash
npm run api                 # port 3000 par defaut
npm run api -- --port 8080  # port custom
```

Endpoints principaux :
- `POST /api/pipeline` : chaine complete (preprocess + compile + run)
- `POST /api/compile` : compiler un scenario
- `POST /api/run` : lancer les tests
- `GET  /api/results` : resultats du dernier run
- `GET  /api/screenshots/:name` : recuperer un screenshot

---

## Sorties (apres npm test)

| Fichier | Contenu |
|---------|---------|
| `test-output/summary.json` | Recap global (JSON) |
| `test-output/summary.md` | Recap global (Markdown) |
| `test-output/report.html` | Rapport visuel HTML |
| `test-output/evolution.html` | Graphe d'evolution multi-runs |
| `test-output/screenshots/success/` | Screenshots des tests reussis |
| `test-output/screenshots/failed/` | Screenshots des tests echoues (+ par step) |
| `test-output/logs/*.json` | Log detaille par test |
| `test-output/run.jsonl` | Un enregistrement JSON par test |

---

## Exemple rapide de bout en bout

```bash
# Installer les dependances
npm i

# Scanner Google (exemple)
npm run map -- https://google.com --no-embeddings

# Compiler le scenario
npm run compile -- scenario.md

# Lancer en mode visible
npm run run -- --headed
```
