import { z } from "zod";

const nodeInputSchema = z.object({
  id: z.string().min(1).max(64),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(2333),
  password: z.string().min(1).optional(),
  secure: z.boolean().default(false),
});

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  BOT_OWNER_IDS: z.string().default(""),
  LAVALINK_HOST: z.string().min(1),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  LAVALINK_PASSWORD: z.string().min(1),
  LAVALINK_SECURE: z.string().default("false"),
  LAVALINK_IDENTIFIER: z.string().min(1).default("primary"),
  LAVALINK_NODES: z.string().default("[]"),
  REDIS_URL: z.string().optional(),
  DEFAULT_PREFIX: z.string().min(1).max(5).default("*"),
  DEFAULT_SEARCH_PLATFORM: z.string().min(1).default("ytsearch"),
  MAX_QUEUE_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
  MAX_PLAYLIST_TRACKS: z.coerce.number().int().min(1).max(5000).default(500),
  COMMAND_COOLDOWN_MS: z.coerce.number().int().min(0).max(60000).default(1500),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MAINTENANCE_MODE: z.string().default("false"),
});

export interface LavalinkNodeConfig {
  id: string;
  host: string;
  port: number;
  password: string;
  secure: boolean;
}

export interface AppConfig {
  discordToken: string;
  databaseUrl: string;
  redisUrl?: string;
  owners: Set<string>;
  lavalinkNodes: LavalinkNodeConfig[];
  defaultPrefix: string;
  searchPlatform: string;
  maxQueueSize: number;
  maxPlaylistTracks: number;
  cooldownMs: number;
  logLevel: z.infer<typeof envSchema>["LOG_LEVEL"];
  maintenanceMode: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.join(".")).filter(Boolean);
    throw new Error(`Invalid environment configuration (${[...new Set(keys)].join(", ") || "unknown field"}).`);
  }

  const env = parsed.data;
  const secure = parseBoolean(env.LAVALINK_SECURE, "LAVALINK_SECURE");
  let extraNodes: unknown;
  try {
    extraNodes = JSON.parse(env.LAVALINK_NODES);
  } catch {
    throw new Error("LAVALINK_NODES must be a JSON array.");
  }
  const extraNodesResult = z.array(nodeInputSchema).safeParse(extraNodes);
  if (!extraNodesResult.success) throw new Error("LAVALINK_NODES contains an invalid node definition.");

  const configuredNodes: LavalinkNodeConfig[] = [
    {
      id: env.LAVALINK_IDENTIFIER,
      host: env.LAVALINK_HOST,
      port: env.LAVALINK_PORT,
      password: env.LAVALINK_PASSWORD,
      secure,
    },
    ...extraNodesResult.data.map((node) => ({
      ...node,
      password: node.password ?? env.LAVALINK_PASSWORD,
    })),
  ];
  const duplicate = configuredNodes.find((node, index) =>
    configuredNodes.slice(0, index).some((other) => other.id === node.id),
  );
  if (duplicate) throw new Error(`Lavalink node identifiers must be unique (${duplicate.id}).`);

  return {
    discordToken: env.DISCORD_BOT_TOKEN,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL || undefined,
    owners: new Set(env.BOT_OWNER_IDS.split(",").map((id) => id.trim()).filter(Boolean)),
    lavalinkNodes: configuredNodes,
    defaultPrefix: env.DEFAULT_PREFIX,
    searchPlatform: env.DEFAULT_SEARCH_PLATFORM,
    maxQueueSize: env.MAX_QUEUE_SIZE,
    maxPlaylistTracks: env.MAX_PLAYLIST_TRACKS,
    cooldownMs: env.COMMAND_COOLDOWN_MS,
    logLevel: env.LOG_LEVEL,
    maintenanceMode: parseBoolean(env.MAINTENANCE_MODE, "MAINTENANCE_MODE"),
  };
}

function parseBoolean(value: string, name: string): boolean {
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  throw new Error(`${name} must be true or false.`);
}