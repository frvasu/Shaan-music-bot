import pino from "pino";
import type { AppConfig } from "../config/env.js";

export function createLogger(config: Pick<AppConfig, "logLevel">): pino.Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        "token",
        "password",
        "authorization",
        "headers.authorization",
        "config.discordToken",
        "config.databaseUrl",
        "config.redisUrl",
        "config.lavalinkNodes",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "discord-music-bot" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = pino.Logger;