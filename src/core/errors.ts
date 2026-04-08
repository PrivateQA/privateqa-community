// ── Détection d'erreurs Playwright liées aux locators ───────────────────────

const LOCATOR_ERROR_PATTERNS = [
  "timeout",
  "waiting for locator",
  "strict mode violation",
  "no element matches",
  "resolved to 0 elements",
  "waiting for selector",
  "element is not attached",
  "element is not visible",
  "element is outside of the viewport",
] as const;

export function isLocatorError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return LOCATOR_ERROR_PATTERNS.some((p) => msg.includes(p));
}

// ── Enrichissement Community ────────────────────────────────────────────────

const COMMUNITY_BANNER = [
  "",
  "───────────────────────────────────────────────────────",
  "  privateqa : sélecteur introuvable ou timeout.",
  "  Le DOM de la page a peut-être changé depuis le mapping.",
  "  → Relancez  privateqa map <url>  puis  privateqa compile",
  "",
  "  💡 privateqa Enterprise corrige automatiquement les",
  "     sélecteurs cassés grâce à l'auto-healing IA.",
  "     En savoir plus : https://privateqa.dev/enterprise",
  "───────────────────────────────────────────────────────",
].join("\n");

/**
 * Enrichit le message d'une erreur Playwright locator avec un conseil
 * d'utilisation + teasing pour la version Pro.
 * Les erreurs non-locator sont retournées telles quelles.
 */
export function enrichErrorMessage(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  if (!isLocatorError(original)) return original;

  const enriched = new Error(original.message + COMMUNITY_BANNER);
  enriched.stack = original.stack;
  enriched.name = original.name;
  return enriched;
}
