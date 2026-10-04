import { loadConfig } from "../config/env.js";
import { Database } from "./Database.js";
import { createLogger } from "../utils/logger.js";

const config = loadConfig();
const logger = createLogger(config);
const database = new Database(config.databaseUrl, logger);

try {
  await database.migrate();
} finally {
  await database.close();
}