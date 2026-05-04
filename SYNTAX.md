# Scenario Syntax Reference

privateqa parses natural-language Markdown files and converts each line into a typed test step. This document describes the formalism the parser expects.

## File structure

```markdown
# Test case title

- Step 1
- Step 2
- Step 3
```

- **Headings** (`#`, `##`, …) are used as test case titles. They are not parsed as steps.
- Compact headings like `#1`, `#LOGIN` are also accepted.
- **Bullet lines** (`-`, `*`, `1.`) are parsed as individual steps.
- **Plain lines** (no bullet) are also accepted.
- **Code blocks** (` ``` `) are skipped entirely.
- **Blank lines** are ignored.

### Multiple test cases

If the file contains multiple headings, each heading starts a new `.spec.ts` file:

```markdown
# Login flow
- Ouvrir "https://app.example.com/login"
- ...

# Dashboard verification
- Ouvrir "https://app.example.com/dashboard"
- ...
```

Prefixes like `TC-01.2:` or `A.1:` are automatically stripped.

---

## Supported step types

### Navigate (`goto`)

Opens a URL in the browser.

| Trigger keywords | Example |
|------------------|---------|
| `ouvrir`, `ouvre` | `Ouvrir "https://example.com"` |
| `je vais sur`, `j'ouvre`, `j'accède sur` | `Je vais sur "https://example.com"` |

The URL must be quoted or appear as the last token.

---

### Click (`click`)

Clicks on an element identified by its visible text.

| Trigger keywords | Example |
|------------------|---------|
| `clique`, `click`, `appuie` | `Clique sur "Submit"` |

**With occurrence index:**

```markdown
- Clique sur "Voir plus" (première occurrence)
- Clique sur "Voir plus" [2]
```

`[N]` selects the Nth occurrence (1-based). `première occurrence` / `first occurrence` maps to `[1]`.

---

### Fill (`fill`)

Types a value into an input field.

| Trigger keywords | Example |
|------------------|---------|
| `remplis`, `saisis`, `entre`, `renseigne` | `Remplis "Email" avec "user@test.com"` |

**Syntax variants:**

```markdown
- Remplis "Email" avec "user@test.com"       # two quoted strings
- Saisis le champ Email avec user@test.com    # keyword ... avec ...
- Renseigne "Password" = "secret"             # target = value
```

When two quoted strings are present, the first is the field label, the second is the value.

---

### Select (`select`)

Selects an option from a dropdown.

| Trigger keywords | Example |
|------------------|---------|
| `sélectionne`, `choisis` | `Sélectionne "France" dans "Pays"` |

**Syntax variants:**

```markdown
- Sélectionne "France" dans "Pays"       # two quoted strings
- Choisis Premium sur Plan                # keyword ... dans/sur ...
```

First quoted string = option label, second = field label.

---

### Verify visibility (`see`)

Asserts that a text is visible on the page.

| Trigger keywords | Example |
|------------------|---------|
| `vois`, `dois voir`, `vérifie`, `vérifier` | `Vérifie que "Welcome" est visible` |

```markdown
- Je dois voir "Dashboard"
- Vérifie la présence du texte "Success"
```

---

### Scroll to top (`scrollTop`)

Scrolls the page back to the top.

| Trigger keywords | Example |
|------------------|---------|
| `scroll` + `en haut` / `haut de page` | `Scroll en haut de la page` |

---

### Scroll to text (`scrollToText`)

Scrolls until a specific text is visible.

| Trigger keywords | Example |
|------------------|---------|
| `scroll` + quoted text | `Scroll jusqu'à "Footer section"` |

---

### Wait (`wait`)

Pauses execution for a duration.

| Trigger keywords | Example |
|------------------|---------|
| `j'attends`, `je attends` | `J'attends 2 s` |

Unit can be `ms` (default) or `s`. `J'attends 500` = 500ms. `J'attends 3 s` = 3000ms.

---

### Unknown

Any line that does not match the above patterns is tagged as `unknown` and emitted as a `// TODO` comment in the generated spec.

---

## Quoting rules

- **Double quotes** (`"…"` or `"…"`) are the primary way to delimit targets and values.
- **Single quotes** (`'…'`) are also supported.
- Curly/smart quotes are normalized automatically.
- Apostrophes inside double-quoted strings are preserved: `"Résultats de l'analyse"` works.

---

## Compound steps

If a single line combines `scroll` and `click` joined by `et` (and), the parser splits it into two separate steps:

```markdown
- Scroll jusqu'à "Prix" et clique sur "Acheter"
```

Produces two steps: `scrollToText("Prix")` then `click("Acheter")`.

---

## Line prefixes (auto-stripped)

The following prefixes are silently removed before parsing:

| Pattern | Example |
|---------|---------|
| Numbered prefixes | `1.2.3:`, `A.1:`, `TC-01.2:` |
| Label prefixes | `Action:`, `Résultat attendu:`, `Expected:` |
| Trailing punctuation | `;`, `.` at end of line |

This means you can write structured scenarios like:

```markdown
## TC-01: Login

- A.1: Action: Ouvrir "https://app.example.com"
- A.2: Action: Remplis "Email" avec "admin@test.com"
- A.3: Résultat attendu: Vérifie que "Dashboard" est visible
```

And they will be parsed identically to:

```markdown
- Ouvrir "https://app.example.com"
- Remplis "Email" avec "admin@test.com"
- Vérifie que "Dashboard" est visible
```
