const { execSync } = require("child_process");

try {
  execSync("playwright install chromium", { stdio: "inherit" });
} catch {
  console.log("");
  console.log("[privateqa] Chromium auto-install skipped.");
  console.log("[privateqa] Run:  npx playwright install chromium");
}

console.log("");
console.log("  privateqa-community installed successfully!");
console.log("");
console.log("  Quick start:");
console.log("    1. Write a scenario (scenario.md):");
console.log('       - Ouvrir "https://your-app.com"');
console.log('       - Clique sur "Login"');
console.log('       - Verifie que "Welcome" est visible');
console.log("");
console.log("    2. Run it:");
console.log("       npx privateqa run scenario.md");
console.log("");
console.log("  Docs:   npx privateqa --help");
console.log("  Syntax: https://github.com/PrivateQA/privateqa-community#scenario-syntax");
console.log("");
