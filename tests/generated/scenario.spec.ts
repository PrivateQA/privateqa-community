import { test, expect, qaStep } from "../_privateqa/base";

test("Scenario: A - Ouvrir https://gulafront.vercel.app;", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await qaStep(testInfo, page, 1, "Ouvrir https://gulafront.vercel.app", async () => {
    await page.goto("https://gulafront.vercel.app");
  });
  await qaStep(testInfo, page, 2, "Clique sur \"Donnée d'exemple\"", async () => {
    const _el2 = page.locator("button:visible", { hasText: "Donnée d'exemple" }).or(page.locator("a:visible", { hasText: "Donnée d'exemple" })).or(page.locator("text=" + "Donnée d'exemple" + ":visible"));
    await _el2.click({ timeout: 15000 });
  });
  await qaStep(testInfo, page, 3, "Vérifier que le texte \"Résultats de l'analyse\" est visible", async () => {
    await expect(page.locator("*:visible", { hasText: /Résultats\s+de\s+l['']analyse/ }).first()).toBeVisible({ timeout: 15000 });
  });
  await qaStep(testInfo, page, 4, "Clique sur \"Voir plus\" (première occurence)", async () => {
    const _el4 = page.locator("button:visible", { hasText: "Voir plus" }).or(page.locator("a:visible", { hasText: "Voir plus" })).or(page.locator("text=" + "Voir plus" + ":visible")).nth(0);
    await _el4.click({ timeout: 15000 });
  });
  await qaStep(testInfo, page, 5, "Vérifie la présence du text \"Recommandation\"", async () => {
    await expect(page.locator("*:visible", { hasText: /Recommandation/ }).first()).toBeVisible({ timeout: 15000 });
  });
  await qaStep(testInfo, page, 6, "scroll jus'au text \"Avertissement médical\" pour en vérifier la présence", async () => {
    const _el6 = page.locator("*:visible", { hasText: /Avertissement\s+médical/ }).first();
    await _el6.scrollIntoViewIfNeeded();
    await expect(_el6).toBeVisible({ timeout: 15000 });
  });
  await qaStep(testInfo, page, 7, "scroll en haut de la page", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }));
  });
  await qaStep(testInfo, page, 8, "click sur le text \"Nouvelle analyse\"", async () => {
    const _el8 = page.locator("button:visible", { hasText: "Nouvelle analyse" }).or(page.locator("a:visible", { hasText: "Nouvelle analyse" })).or(page.locator("text=" + "Nouvelle analyse" + ":visible"));
    await _el8.click({ timeout: 15000 });
  });
  await qaStep(testInfo, page, 9, "vérifie si le text \"Pourquoi Choisir Gula\" est présent", async () => {
    await expect(page.locator("*:visible", { hasText: /Pourquoi\s+Choisir\s+Gula/ }).first()).toBeVisible({ timeout: 15000 });
  });
});
