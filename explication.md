# fwkTest - Framework de Tests E2E "Agentique" & On-Premise

## 1. Vision du Projet

fwkTest est un framework de tests automatisés nouvelle génération conçu pour les environnements **Enterprise**. Il permet de transformer des **cahiers de tests rédigés en langage naturel (Français/Gherkin)** en scripts Playwright exécutables et robustes, sans qu'aucune donnée ne sorte du réseau de l'entreprise.

**Différenciateurs Clés :**

- **100% On-Premise :** Fonctionne avec des modèles IA locaux (Ollama) pour une conformité RGPD/Sécurité totale.
- **Architecture Agentique :** L'IA n'est pas un simple assistant de code, elle agit comme un compilateur intelligent (Mapping -> Génération -> Validation).
- **Auto-Healing :** Capacité autonome de réparation des sélecteurs brisés lors de l'exécution.

## 2. Architecture Technique : Pattern "Compiler & Mapper"

Contrairement à une approche classique "Text-to-Code" directe, fwkTest sépare la compréhension de l'interface de la génération du test.

### Le Workflow en 4 Étapes :

1. **Phase de Découverte (The Mapper Agent)**
    - **Action :** Le système scanne l'URL de l'application cible.
    - **Technique :** Extraction du DOM interactif -> Vectorisation des éléments (via `nomic-embed-text`) -> Stockage dans un "Store Vectoriel" éphémère ou local.
    - **Résultat :** Une "Carte" sémantique de l'application (ex: "Le vecteur 'Bouton Valider' correspond au sélecteur `#submit-btn-v2`").
2. **Phase de Compilation (The Builder Agent)**
    - **Action :** Le système lit le fichier de scénario (ex: `.feature` ou `.md`).
    - **Technique :** Le LLM (ex: Qwen2.5 / `Mistral` ) croise chaque instruction du scénario avec la "Carte" pour générer du code Playwright précis.
    - **Résultat :** Création de fichiers `.spec.ts` standardisés et stables.
3. **Phase d'Exécution (The Runner)**
    - **Action :** Lancement des tests via le moteur Playwright standard.
    - **Spécificité :** Aucune IA n'est active ici pour garantir la vitesse (Performance native).
4. **Phase de Maintenance (The Healer Agent)**
    - **Action :** Intervient uniquement en cas d'échec (ex: `TimeoutError`).
    - **Technique :** Capture le DOM cassé + Screenshot -> Analyse LLM Vision -> Recherche du nouveau sélecteur -> Patch du code.

## 3. Stack Technologique

- **Langage :** TypeScript (Node.js)
- **Moteur de Test :** Playwright
- **IA & LLM (Local) :**
    - Orchestration : LangChain.js ou implémentation native (fetch vers Ollama).
    - Moteur d'inférence : **Ollama**.
    - Modèle Logique : `Mistral` (Génération de code).
    - Modèle Embedding : `nomic-embed-text` (Compréhension sémantique du DOM).
- **Base de données (Metadatas & Vecteurs) :**
    - Début : JSON local / In-memory (LokiJS ou simple Map).
    - Cible : SQLite (avec extension vectorielle) ou ChromaDB local.

## 4. Structure du Repository

Plaintext

`/`fwkTest 
`├── /bin                # Point d'entrée CLI (ex:` fwkTest `init,` fwkTest `compile)
├── /examples           # Scénarios de démonstration (Gherkin/Français)
├── /src
│   ├── /core           # Le moteur d'exécution standard
│   │   ├── runner.ts   # Wrapper autour de Playwright
│   │   └── config.ts   # Configuration du projet
│   │
│   ├── /agents         # Les "Cerveaux" de l'IA
│   │   ├── /mapper     # Agent de découverte (DOM -> Embeddings)
│   │   ├── /builder    # Agent de traduction (Scénario -> Code .spec.ts)
│   │   └── /healer     # Agent de réparation (Debug & Patch)
│   │
│   ├── /infrastructure # Gestion technique
│   │   ├── ollama.ts   # Client API pour communiquer avec Ollama
│   │   └── store.ts    # Gestion de la base vectorielle locale
│   │
│   └── /utils          # Parsers (DOM, Gherkin), Loggers
│
├── /templates          # Templates de fichiers Playwright (Page Objects, base test)
├── package.json
├── tsconfig.json
└── README.md`

## 5. Roadmap de Développement (MVP)

1. **Semaine 1 : Setup & Embedding.** Initialiser le projet TS. Réussir à transformer une liste d'éléments HTML simples en vecteurs via Ollama (`nomic-embed-text`).
2. **Semaine 2 : Le Mapper.** Créer le script qui visite une page et construit le dictionnaire JSON "Description Sémantique -> Sélecteur CSS".
3. **Semaine 3 : Le Builder.** Créer le prompt qui prend une phrase "Je me connecte", cherche dans le dictionnaire, et sort la ligne `await page.click(...)`.
4. **Semaine 4 : Assemblage CLI.** Rendre le tout exécutable via une commande `npx` fwkTest `build`.