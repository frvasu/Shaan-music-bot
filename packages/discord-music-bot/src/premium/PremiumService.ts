import type { Database } from "../database/Database.js";
import type { Logger } from "../utils/logger.js";

export type PremiumSubject = "user" | "guild";
export type PremiumFeature = "extended_queue" | "advanced_filters" | "247" | "autoplay" | "playlists";

export class PremiumService {
  constructor(private readonly database: Database, private readonly logger: Logger) {}

  async isPremium(subject: PremiumSubject, subjectId: string): Promise<boolean> {
    const table = subject === "guild" ? "premium_guilds" : "premium_users";
    const column = subject === "guild" ? "guild_id" : "user_id";
    const result = await this.database.query<{ active: boolean }>(
      `SELECT active_until > NOW() AS active FROM ${table} WHERE ${column} = $1`,
      [subjectId],
    );
    return result.rows[0]?.active ?? false;
  }

  async hasFeature(userId: string, guildId: string, feature: PremiumFeature): Promise<boolean> {
    if (!Object.hasOwn(FEATURE_POLICIES, feature)) return false;
    const [userPremium, guildPremium] = await Promise.all([
      this.isPremium("user", userId),
      this.isPremium("guild", guildId),
    ]);
    return userPremium || guildPremium;
  }

  async activate(
    subject: PremiumSubject,
    subjectId: string,
    activeUntil: Date,
    assignedBy: string,
  ): Promise<void> {
    if (!Number.isFinite(activeUntil.getTime()) || activeUntil.getTime() <= Date.now()) {
      throw new Error("Premium expiry must be a future date.");
    }
    await this.database.transaction(async (client) => {
      if (subject === "guild") {
        await client.query("INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT DO NOTHING", [subjectId]);
        await client.query(
          `INSERT INTO premium_guilds (guild_id, active_until, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (guild_id) DO UPDATE SET active_until = EXCLUDED.active_until, assigned_by = EXCLUDED.assigned_by`,
          [subjectId, activeUntil, assignedBy],
        );
      } else {
        await client.query(
          "INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
          [subjectId],
        );
        await client.query(
          `INSERT INTO premium_users (user_id, active_until, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET active_until = EXCLUDED.active_until, assigned_by = EXCLUDED.assigned_by`,
          [subjectId, activeUntil, assignedBy],
        );
      }
      await client.query(
        "INSERT INTO audit_logs (actor_id, action, target_id, details) VALUES ($1, 'premium.activate', $2, $3::jsonb)",
        [assignedBy, subjectId, JSON.stringify({ subject, activeUntil: activeUntil.toISOString() })],
      );
    });
  }

  async revoke(subject: PremiumSubject, subjectId: string, actorId: string): Promise<void> {
    const table = subject === "guild" ? "premium_guilds" : "premium_users";
    const column = subject === "guild" ? "guild_id" : "user_id";
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO premium_expirations (subject_type, subject_id, source) VALUES ($1, $2, 'revoked')`,
        [subject, subjectId],
      );
      await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [subjectId]);
      await client.query(
        "INSERT INTO audit_logs (actor_id, action, target_id, details) VALUES ($1, 'premium.revoke', $2, $3::jsonb)",
        [actorId, subjectId, JSON.stringify({ subject })],
      );
    });
  }

  async recordPayment(record: {
    provider: string;
    providerReference: string;
    subjectType: PremiumSubject;
    subjectId: string;
    amountMinor: number;
    currency: string;
    status: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO payment_records
        (provider, provider_reference, subject_type, subject_id, amount_minor, currency, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (provider, provider_reference) DO NOTHING`,
      [
        record.provider,
        record.providerReference,
        record.subjectType,
        record.subjectId,
        record.amountMinor,
        record.currency.toUpperCase(),
        record.status,
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  async expireDue(): Promise<number> {
    return this.database.transaction(async (client) => {
      const guilds = await client.query<{ guild_id: string }>(
        "DELETE FROM premium_guilds WHERE active_until <= NOW() RETURNING guild_id",
      );
      const users = await client.query<{ user_id: string }>(
        "DELETE FROM premium_users WHERE active_until <= NOW() RETURNING user_id",
      );
      for (const row of guilds.rows) {
        await client.query(
          "INSERT INTO premium_expirations (subject_type, subject_id) VALUES ('guild', $1)",
          [row.guild_id],
        );
      }
      for (const row of users.rows) {
        await client.query(
          "INSERT INTO premium_expirations (subject_type, subject_id) VALUES ('user', $1)",
          [row.user_id],
        );
      }
      return (guilds.rowCount ?? 0) + (users.rowCount ?? 0);
    }).catch((error: unknown) => {
      this.logger.error({ err: error }, "Premium expiration sweep failed");
      throw error;
    });
  }
}

const FEATURE_POLICIES: Record<PremiumFeature, true> = {
  extended_queue: true,
  advanced_filters: true,
  "247": true,
  autoplay: true,
  playlists: true,
};