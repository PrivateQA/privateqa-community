import { spawn } from "node:child_process";

export async function runPlaywright(extraArgs: string[] = []) {
  const child = spawn("npx", ["playwright", "test", ...extraArgs], {
    stdio: "inherit",
    shell: true,
  });
  await new Promise<void>((res, rej) => {
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`playwright test exit ${code}`))));
    child.on("error", rej);
  });
}

