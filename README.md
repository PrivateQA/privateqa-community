# privateqa

Write end-to-end tests in plain language, run them with Playwright — zero config.

## Install

```bash
npm install privateqa-community
```

That's it. Playwright and Chromium are installed automatically.

## Quick start

**1. Write a scenario** (`scenario.md`):

```markdown
# Login test

- Ouvrir "https://your-app.example.com"
- Clique sur "Login"
- Remplis "Email" avec "user@example.com"
- Remplis "Password" avec "secret"
- Clique sur "Submit"
- Vérifie que "Welcome" est visible
```

**2. Run it:**

```bash
npx privateqa run scenario.md
```

Done. privateqa maps the page, compiles the scenario to a Playwright spec, and executes the test — all in one command.

### Options

```bash
npx privateqa run scenario.md --headed        # see the browser
npx privateqa run scenario.md --url <url>     # override the URL
npx privateqa run scenario.md --no-map        # reuse existing DOM map
```

## Scenario syntax

See [SYNTAX.md](./SYNTAX.md) for the full reference. Quick summary:

| Step | Example |
|------|---------|
| Navigate | `Ouvrir "https://example.com"` |
| Click | `Clique sur "Login"` |
| Fill | `Remplis "Email" avec "user@test.com"` |
| Select | `Sélectionne "France" dans "Country"` |
| Assert | `Vérifie que "Welcome" est visible` |
| Scroll | `Scroll jusqu'à "Footer"` |
| Wait | `J'attends 2s` |

## Advanced: step-by-step commands

For more control, you can run each stage separately:

```bash
npx privateqa map https://your-app.com          # 1. Map the DOM
npx privateqa compile scenario.md                # 2. Generate .spec.ts
npx privateqa run                                # 3. Run all generated tests
```

## CLI reference

| Command | Description |
|---------|-------------|
| `privateqa run <scenario.md>` | **All-in-one**: map + compile + execute |
| `privateqa run` | Execute already-generated tests |
| `privateqa map <url>` | Crawl a URL and build a DOM map |
| `privateqa compile <scenario.md>` | Generate Playwright spec(s) from a scenario |
| `privateqa report` | Generate an HTML report from the last run |
| `privateqa evolution` | Generate an evolution chart across runs |
| `privateqa api` | Start the REST API server |

## Plugin system

Extend privateqa with plugins to intercept step failures, add retry logic, or hook into the test lifecycle:

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

| Hook | When |
|------|------|
| `onStepFailure(ctx)` | A test step throws — return `retry`, `skip`, or `fail` |
| `onTestBegin(page, testInfo)` | Before each test |
| `onTestEnd(page, testInfo)` | After each test |

## Exports

| Import path | Contents |
|-------------|----------|
| `privateqa-community` | Plugin API, step types, builder, store |
| `privateqa-community/base` | Playwright fixtures (`test`, `expect`, `qaStep`) |
| `privateqa-community/plugin` | Plugin types and registry |
| `privateqa-community/errors` | Error detection and enrichment |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server for AI features |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `OLLAMA_GEN_MODEL` | `mistral` | Generation model |
| `HEADLESS` | `true` | Run browser headless |
| `PRIVATEQA_MAX_RETRIES` | `1` | Max plugin retry attempts per step |

## License

[MIT](./LICENSE)
