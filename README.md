# privateqa

Write end-to-end tests in natural language, run them with Playwright.

privateqa translates human-readable scenarios (plain text / Markdown) into fully executable Playwright test specs — no step definitions, no Gherkin boilerplate.

## Features

- **Natural-language scenarios** — Describe test steps in French or English, privateqa parses and compiles them to Playwright TypeScript.
- **DOM mapping** — Crawl a page to build a map of interactive elements with optional embeddings for smart locator matching.
- **Smart locator resolution** — Matches scenario intent to real DOM elements using cosine similarity (embeddings) or Jaccard text matching.
- **Plugin system** — Extend the test runtime with plugins (error interception, retry logic, custom hooks).
- **Detailed reporting** — Per-step screenshots, JSON logs, HTML reports, and run-over-run evolution charts.
- **CLI + REST API** — Use from the terminal or integrate via HTTP.

## Quick start

```bash
npm install privateqa-community @playwright/test
npx playwright install
```

### 1. Map your application

```bash
npx privateqa map https://your-app.example.com
```

This crawls the page and creates `.privateqa/map.json` with all interactive elements.

### 2. Write a scenario

Create a Markdown file (e.g. `scenario.md`):

```markdown
# My first test

- Ouvrir "https://your-app.example.com"
- Clique sur "Login"
- Remplis "Email" avec "user@example.com"
- Remplis "Password" avec "secret"
- Clique sur "Submit"
- Vérifie que "Welcome" est visible
```

See [SYNTAX.md](./SYNTAX.md) for the full formalism reference.

### 3. Compile to Playwright

```bash
npx privateqa compile scenario.md
```

This generates a `.spec.ts` file in `tests/generated/`.

### 4. Run

```bash
npx playwright test
```

## CLI reference

| Command | Description |
|---------|-------------|
| `privateqa map <url>` | Crawl a URL and build a DOM map |
| `privateqa preprocess <scenario.md>` | Normalize steps with optional AI assistance |
| `privateqa compile <scenario.md>` | Generate Playwright spec(s) from a scenario |
| `privateqa run [--headed]` | Run generated tests via Playwright |
| `privateqa report` | Generate an HTML report from the last run |
| `privateqa evolution` | Generate an evolution chart across runs |
| `privateqa api` | Start the REST API server |

## Plugin system

privateqa exposes a plugin API to intercept step failures, add retry logic, or hook into test lifecycle events.

```typescript
import { registerPlugin } from "privateqa-community";
import type { QAPlugin } from "privateqa-community";

const myPlugin: QAPlugin = {
  name: "my-plugin",
  async onStepFailure(ctx) {
    console.log(`Step "${ctx.label}" failed:`, ctx.error.message);
    return { action: "fail" };
  },
};

registerPlugin(myPlugin);
```

### Plugin hooks

| Hook | When |
|------|------|
| `onStepFailure(ctx)` | A test step throws — return `retry`, `skip`, or `fail` |
| `onTestBegin(page, testInfo)` | Before each test |
| `onTestEnd(page, testInfo)` | After each test |

## Exports

| Import path | Contents |
|-------------|----------|
| `privateqa-community` | Plugin API, step types, builder, store |
| `privateqa-community/base` | Playwright test fixtures (`test`, `expect`, `qaStep`) |
| `privateqa-community/plugin` | Plugin types and registry only |
| `privateqa-community/errors` | Error detection and enrichment utilities |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server for AI features |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `OLLAMA_GEN_MODEL` | `mistral` | Generation model |
| `HEADLESS` | `true` | Run browser headless |
| `TEST_OUTPUT_DIR` | `test-output` | Output directory for reports |
| `PRIVATEQA_MAX_RETRIES` | `1` | Max plugin retry attempts per step |

## License

[MIT](./LICENSE)
