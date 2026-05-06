# privateqa

Write end-to-end tests in plain language (French or English), run them with Playwright — zero config.

## Install

```bash
npm install privateqa-community
```

That's it. Playwright and Chromium are installed automatically.

This README documents the **Community** edition only.

Looking for production-grade capabilities? See [privateqa.com](https://privateqa.com): Enterprise adds AI-powered local auto-healing for unstable selectors, secure Docker deployment, CI/CD integration, and WCAG accessibility reporting. The platform is designed for security-first teams, with execution in an isolated environment and controlled network exposure.

### Try the bundled example scenario

The npm package includes `scenarioExemple.md` so you can try the full pipeline immediately:

```bash
npx privateqa run scenarioExemple.md --headed
```

If you installed via npm, these example files are located in `node_modules/privateqa-community/`.
Copy `scenarioExemple.md` and `glossary.json` to your project root before running them directly.

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

Done. privateqa maps the page, compiles the scenario to a Playwright spec, and executes the test — all in one command. A detailed HTML report opens automatically after execution.

### Options

```bash
npx privateqa run scenario.md --headed        # see the browser
npx privateqa run scenario.md --url <url>     # override the URL
npx privateqa run scenario.md --no-map        # reuse existing DOM map
npx privateqa run scenario.md --map-headed    # show browser during mapping only
npx privateqa run scenario.md --glossary .privateqa/glossary.json  # apply business glossary
npx privateqa run scenario.md --save          # save run in evolution history
npx privateqa run scenario.md --wcag          # include WCAG accessibility audit
npx privateqa run scenario.md --reporter      # open report in Chromium at the end
npx privateqa run scenario.md --no-open       # don't auto-open report
npx privateqa run scenario.md --no-validate   # skip pre-run scenario validation
```

## Scenario syntax

You can write scenarios in **French or English**. Both are supported by the parser for the same core actions (navigate, click, fill, select, assert, wait, scroll).

| Step | Example |
|------|---------|
| Navigate | `Ouvrir "https://example.com"` |
| Click | `Clique sur "Login"` |
| Fill | `Remplis "Email" avec "user@test.com"` |
| Select | `Sélectionne "France" dans "Country"` |
| Assert | `Vérifie que "Welcome" est visible` |
| Scroll to text | `Scroll jusqu'à "Footer"` |
| Scroll to top | `Scroll en haut de la page` |
| Wait | `J'attends 2s` |
| Compound | `Scroll jusqu'à "Prix" et clique sur "Acheter"` |

Targets and values are wrapped in quotes (`"…"`). Multiple test cases can be defined using headings (`#`, `##`, `#1`, `#LOGIN`) — each heading generates a separate `.spec.ts` file.

By default, privateqa keeps the same browser tab/page between generated tests in the same run. This means you can chain segmented scenarios and avoid repeating `Ouvrir "https://..."` at the beginning of every section.

Structured prefixes like `A.1:`, `TC-01:`, or `Action:` are automatically stripped, so you can write formal test plans and privateqa will parse them correctly.

Full reference: [SYNTAX.md](https://github.com/PrivateQA/privateqa-community/blob/main/SYNTAX.md)

## Business glossary (Community)

If your teams use domain-specific wording (banking, insurance, medical, etc.), you can define a deterministic glossary and privateqa will rewrite those expressions before parsing steps.

- Default paths (auto-applied): `.privateqa/glossary.json` then `glossary.json`
- Custom path: `--glossary <path>`
- Bundled default glossary: `glossary.json`

Example format:

```json
{
  "version": 1,
  "terms": {
    "FLC": {
      "mapsTo": "Formulaire Liste de Conformite",
      "uiHints": ["Formulaire FLC", "formulaire conformite"]
    }
  },
  "actions": {
    "valider dossier": "Clique sur \"Valider le dossier\""
  }
}
```

Concrete test on [privateqa.com](https://privateqa.com/):

```json
{
  "version": 1,
  "terms": {
    "mail": {
      "mapsTo": "contact",
      "uiHints": ["page de mail", "page mail"]
    },
    "request demo": {
      "mapsTo": "Request Demo",
      "uiHints": ["demander une demo"]
    }
  },
  "actions": {
    "ouvrir la page de mail": "Clique sur \"Request Demo\"",
    "verifier le formulaire de contact": "Verifie que \"Envoyez-nous un message\" est visible"
  }
}
```

Scenario using this glossary:

```markdown
- Ouvrir "https://privateqa.com/"
- Ouvrir la page de mail
- Verifier le formulaire de contact
```

How it works:
- `terms`: replaces domain words/aliases with a canonical wording
- `actions`: rewrites business shortcuts into explicit step lines
- Replacement is text-based (deterministic), applied before step parsing

Limits (Community):
- No semantic inference: unknown terms are not guessed automatically
- Replacements are lexical: keep glossary keys explicit and unambiguous
- For advanced semantic interpretation, use Enterprise capabilities

## Validate before run

`run` now validates the scenario before compile/execute (after glossary replacement).
If unknown steps are detected, the run stops early with explicit feedback.

```bash
npx privateqa validate scenario.md
npx privateqa validate scenario.md --allow-unknown
```

## Reports

Every run generates a full HTML report with:

- Per-step pass/fail status and duration
- Screenshots at each step (success and failure)
- Error details with Playwright call logs
- Overall summary with charts

Use `--save` to accumulate runs into an **evolution chart** that tracks your test health over time.

## Advanced: step-by-step commands

For more control, you can run each stage separately:

```bash
npx privateqa map https://your-app.com          # 1. Map the DOM
npx privateqa compile scenario.md --glossary .privateqa/glossary.json  # 2. Generate .spec.ts
npx privateqa run                                # 3. Run all generated tests
npx privateqa test                               # 4. Re-run generated specs only (no map/compile)
```

## CLI reference

| Command | Description |
|---------|-------------|
| `privateqa run <scenario.md>` | **All-in-one**: map + compile + execute + report |
| `privateqa validate <scenario.md>` | Validate parsed steps and fail on unknown lines |
| `privateqa run` | Execute already-generated tests |
| `privateqa test` | Execute already-generated tests with privateqa reporter |
| `privateqa map <url>` | Crawl a URL and build a DOM map |
| `privateqa compile <scenario.md>` | Generate Playwright spec(s) from a scenario |
| `privateqa report` | Generate an HTML report from the last run |
| `privateqa evolution` | Generate an evolution chart across runs |
| `privateqa api` | Start the REST API server |

With `--wcag`, `run` / `test` include a WCAG accessibility scan (axe-core) and add a synthetic accessibility section in the report.

## Plugin system

privateqa exposes a plugin API to intercept step failures, add retry logic, or hook into the test lifecycle:

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
| `PRIVATEQA_SINGLE_BROWSER` | `true` | Run generated specs with one Playwright worker (single browser instance) |
| `PRIVATEQA_KEEP_TAB` | `true` | Reuse the same Playwright page/tab across tests (same worker) |

## License

[MIT](./LICENSE)
