type Level = "debug" | "info" | "warn" | "error";

import { LOG_LEVEL } from "../config";

const levelOrder: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const threshold = ((): Level => {
  if (LOG_LEVEL === "debug" || LOG_LEVEL === "info" || LOG_LEVEL === "warn" || LOG_LEVEL === "error") return LOG_LEVEL as Level;
  return "info";
})();

function log(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (levelOrder[level] < levelOrder[threshold]) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => log("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => log("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log("error", msg, extra),
};

