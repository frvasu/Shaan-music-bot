import type { Database } from "../database/Database.js";
import type { Logger } from "../utils/logger.js";

export interface GuildSettings {
  guildId: string;
  prefix: string;
  djRoleId: string | null;
  djChannelId: string | null;
  allowedChannelIds: string[];
  blockedChannelIds: string[];
  defaultVolume: number;
  autoplay: boolean;
  stay247: boolean;
  announcements: boolean;
  nowPlayingChannelId: string | null;
  sourceSettings: Record<string, unknown>;
}

export type GuildSettingsPatch = Partial<Omit<GuildSettings, "guildId" | "prefix">>;

export class GuildSettingsService {
  constructor(private readonly database: Database, private readonly logger: Logger) {}

  async get(guildId: string): Promise<GuildSettings> {
    await this.ensureGuild(guildId);
    const result = await this.database.query<{
      prefix: string;
      dj_role_id: string | null;
      dj_channel_id: string | null;
      allowed_channel_ids: string[];
      blocked_channel_ids: string[];
      default_volume: number;
      autoplay: boolean;
      stay_247: boolean;
      announcements: boolean;
      now_playing_channel_id: string | null;
      source_settings: Record<string, unknown>;
    }>("SELECT * FROM guild_settings WHERE guild_id = $1", [guildId]);
    const row = result.rows[0];
    if (!row) {
      return {
        guildId,
        prefix: "*",
        djRoleId: null,
        djChannelId: null,
        allowedChannelIds: [],
        blockedChannelIds: [],
        defaultVolume: 80,
        autoplay: false,
        stay247: false,
        announcements: true,
        nowPlayingChannelId: null,
        sourceSettings: {},
      };
    }
    return {
      guildId,
      prefix: row.prefix,
      djRoleId: row.dj_role_id,
      djChannelId: row.dj_channel_id,
      allowedChannelIds: row.allowed_channel_ids ?? [],
      blockedChannelIds: row.blocked_channel_ids ?? [],
      defaultVolume: row.default_volume,
      autoplay: row.autoplay,
      stay247: row.stay_247,
      announcements: row.announcements,
      nowPlayingChannelId: row.now_playing_channel_id,
      sourceSettings: row.source_settings ?? {},
    };
  }

  async update(guildId: string, patch: GuildSettingsPatch, actorId: string): Promise<GuildSettings> {
    await this.ensureGuild(guildId);
    const fieldMap: Record<keyof GuildSettingsPatch, { column: string; validate: (value: unknown) => unknown }> = {
      djRoleId: { column: "dj_role_id", validate: (value) => nullableId(value) },
      djChannelId: { column: "dj_channel_id", validate: (value) => nullableId(value) },
      allowedChannelIds: { column: "allowed_channel_ids", validate: validateIds },
      blockedChannelIds: { column: "blocked_channel_ids", validate: validateIds },
      defaultVolume: { column: "default_volume", validate: validateVolume },
      autoplay: { column: "autoplay", validate: validateBoolean },
      stay247: { column: "stay_247", validate: validateBoolean },
      announcements: { column: "announcements", validate: validateBoolean },
      nowPlayingChannelId: { column: "now_playing_channel_id", validate: (value) => nullableId(value) },
      sourceSettings: { column: "source_settings", validate: validateObject },
    };
    const updates = Object.entries(patch) as [keyof GuildSettingsPatch, unknown][];
    if (updates.length === 0) return this.get(guildId);

    await this.database.transaction(async (client) => {
      for (const [key, input] of updates) {
        const definition = fieldMap[key];
        if (!definition) throw new Error("Unsupported guild setting.");
        const value = definition.validate(input);
        const jsonValue = key === "sourceSettings" ? JSON.stringify(value) : value;
        const cast = key === "sourceSettings" ? "::jsonb" : "";
        await client.query(
          `UPDATE guild_settings SET ${definition.column} = $2${cast}, updated_at = NOW() WHERE guild_id = $1`,
          [guildId, jsonValue],
        );
      }
      await client.query(
        "INSERT INTO audit_logs (actor_id, guild_id, action, details) VALUES ($1, $2, 'settings.update', $3::jsonb)",
        [actorId, guildId, JSON.stringify({ keys: updates.map(([key]) => key) })],
      );
    }).catch((error: unknown) => {
      this.logger.error({ err: error }, "Guild settings update failed");
      throw error;
    });
    return this.get(guildId);
  }

  private async ensureGuild(guildId: string): Promise<void> {
    await this.database.query("INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT DO NOTHING", [guildId]);
    await this.database.query(
      "INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [guildId],
    );
  }
}

function nullableId(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{5,25}$/u.test(value)) throw new Error("Invalid Discord ID.");
  return value;
}

function validateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Channel list must contain at most 100 IDs.");
  return [...new Set(value.map((item) => nullableId(item)).filter((item): item is string => Boolean(item)))];
}

function validateVolume(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 200) {
    throw new Error("Default volume must be between 0 and 200.");
  }
  return Number(value);
}

function validateBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("This setting must be true or false.");
  return value;
}

function validateObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid source settings.");
  return value as Record<string, unknown>;
}