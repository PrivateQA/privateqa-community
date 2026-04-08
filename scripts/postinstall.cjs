const { execSync } = require("child_process");
try {
  execSync("playwright install chromium", { stdio: "inherit" });
} catch {
  console.log("");
  console.log("[privateqa] Chromium auto-install skipped.");
  console.log("[privateqa] Run:  npx playwright install chromium");
  console.log("");
}
