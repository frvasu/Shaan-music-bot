import type { Database } from "../database/Database.js";
import type { MusicTrack, TrackPage } from "../types/Track.js";
import { trackKey } from "../types/Track.js";

export class FavoriteService {
  constructor(private readonly database: Database) {}

  async add(userId: string, track: MusicTrack): Promise<boolean> {
    await this.database.query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const result = await this.database.query(
      `INSERT INTO favorites (user_id, track_key, track_data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, track_key) DO NOTHING`,
      [userId, trackKey(track), JSON.stringify(track)],
    );
    return Boolean(result.rowCount);
  }

  async remove(userId: string, keyOrPosition: string | number): Promise<boolean> {
    if (typeof keyOrPosition === "number") {
      const result = await this.database.query(
        `DELETE FROM favorites WHERE user_id = $1 AND track_key = (
           SELECT track_key FROM favorites WHERE user_id = $1 ORDER BY created_at ASC OFFSET $2 LIMIT 1
         )`,
        [userId, keyOrPosition - 1],
      );
      return Boolean(result.rowCount);
    }
    const result = await this.database.query("DELETE FROM favorites WHERE user_id = $1 AND track_key = $2", [
      userId,
      keyOrPosition,
    ]);
    return Boolean(result.rowCount);
  }

  async list(userId: string, page = 1, pageSize = 10): Promise<TrackPage<MusicTrack>> {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new RangeError("Invalid favorites page.");
    }
    const [count, rows] = await Promise.all([
      this.database.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM favorites WHERE user_id = $1", [
        userId,
      ]),
      this.database.query<{ track_data: MusicTrack }>(
        `SELECT track_data FROM favorites WHERE user_id = $1
         ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [userId, pageSize, (page - 1) * pageSize],
      ),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return {
      items: rows.rows.map((row) => row.track_data),
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    };
  }
}