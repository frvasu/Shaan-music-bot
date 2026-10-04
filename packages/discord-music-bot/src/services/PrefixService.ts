import type { CacheService } from "../redis/RedisService.js";
import type { Logger } from "../utils/logger.js";
import type { Database } from "../database/Database.js";

const PREFIX_RE = /^[^\s`]{1,5}$/u;

export class PrefixService {
  constructor(
    private readonly database: Database,
    private readonly cache: CacheService,
    private readonly defaultPrefix: string,
    private readonly logger: Logger,
  ) {}

  async get(guildId: string): Promise<string> {
    const key = `guild:${guildId}:prefix`;
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const result = await this.database.query<{ prefix: string }>(
      "SELECT prefix FROM guild_settings WHERE guild_id = $1",
      [guildId],
    );
    const prefix = result.rows[0]?.prefix ?? this.defaultPrefix;
    await this.cache.set(key, prefix, 3600);
    return prefix;
  }

  async set(guildId: string, prefix: string, actorId: string): Promise<void> {
    const normalized = prefix.trim();
    if (!PREFIX_RE.test(normalized)) throw new Error("Prefix must be 1–5 non-space characters.");
    await this.database.query("INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT DO NOTHING", [guildId]);
    await this.database.query(
      `INSERT INTO guild_settings (guild_id, prefix)
       VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET prefix = EXCLUDED.prefix, updated_at = NOW()`,
      [guildId, normalized],
    );
    await this.cache.set(`guild:${guildId}:prefix`, normalized, 3600);
    try {
      await this.database.query(
        "INSERT INTO audit_logs (actor_id, guild_id, action, details) VALUES ($1, $2, 'prefix.change', $3::jsonb)",
        [actorId, guildId, JSON.stringify({ prefix: normalized })],
      );
    } catch (error) {
      this.logger.warn({ err: error }, "Prefix changed but audit event could not be stored");
    }
  }
}