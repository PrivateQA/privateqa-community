export type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level: LogLevel = "info") {
  const current = levelOrder[level];

  const log = (l: LogLevel, msg: string) => {
    if (levelOrder[l] < current) return;
    console.log(`[${l.toUpperCase()}] ${msg}`);
  };

  return {
    debug: (m: string) => log("debug", m),
    info: (m: string) => log("info", m),
    warn: (m: string) => log("warn", m),
    error: (m: string) => log("error", m),
  };
}

