import type { PoolClient } from "pg";
import type { Database } from "../database/Database.js";
import type { MusicTrack, TrackPage } from "../types/Track.js";

export interface Playlist {
  playlistId: string;
  ownerId: string;
  name: string;
  trackCount?: number;
}

export function normalizePlaylistName(name: string): string {
  const normalized = name.trim().replace(/\s+/gu, " ");
  if (normalized.length < 1 || normalized.length > 80) throw new Error("Playlist names must be 1–80 characters.");
  return normalized;
}

export function reorderPositions<T>(items: T[], from: number, to: number): T[] {
  if (![from, to].every(Number.isInteger) || from < 1 || to < 1 || from > items.length || to > items.length) {
    throw new RangeError(`Track positions must be between 1 and ${items.length}.`);
  }
  const result = [...items];
  const [item] = result.splice(from - 1, 1);
  result.splice(to - 1, 0, item!);
  return result;
}

export class PlaylistService {
  constructor(private readonly database: Database, private readonly maxTracks = 500) {}

  async create(ownerId: string, name: string): Promise<Playlist> {
    const normalized = normalizePlaylistName(name);
    await this.database.query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [ownerId]);
    const result = await this.database.query<Playlist>(
      "INSERT INTO playlists (owner_id, name) VALUES ($1, $2) RETURNING playlist_id AS \"playlistId\", owner_id AS \"ownerId\", name",
      [ownerId, normalized],
    );
    return result.rows[0]!;
  }

  async rename(ownerId: string, playlistId: string, name: string): Promise<void> {
    const normalized = normalizePlaylistName(name);
    const result = await this.database.query(
      "UPDATE playlists SET name = $3, updated_at = NOW() WHERE playlist_id = $1 AND owner_id = $2",
      [playlistId, ownerId, normalized],
    );
    if (!result.rowCount) throw new Error("Playlist not found or you do not own it.");
  }

  async delete(ownerId: string, playlistId: string): Promise<void> {
    const result = await this.database.query("DELETE FROM playlists WHERE playlist_id = $1 AND owner_id = $2", [
      playlistId,
      ownerId,
    ]);
    if (!result.rowCount) throw new Error("Playlist not found or you do not own it.");
  }

  async list(ownerId: string, page = 1, pageSize = 10): Promise<TrackPage<Playlist>> {
    validatePage(page, pageSize);
    const offset = (page - 1) * pageSize;
    const [count, rows] = await Promise.all([
      this.database.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM playlists WHERE owner_id = $1", [
        ownerId,
      ]),
      this.database.query<Playlist>(
        `SELECT p.playlist_id AS "playlistId", p.owner_id AS "ownerId", p.name,
                COUNT(pt.position)::integer AS "trackCount"
         FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.playlist_id
         WHERE p.owner_id = $1
         GROUP BY p.playlist_id
         ORDER BY p.created_at DESC
         LIMIT $2 OFFSET $3`,
        [ownerId, pageSize, offset],
      ),
    ]);
    return makePage(rows.rows, page, pageSize, Number(count.rows[0]?.total ?? 0));
  }

  async findOwned(ownerId: string, nameOrId: string): Promise<Playlist> {
    const result = await this.database.query<Playlist>(
      `SELECT playlist_id AS "playlistId", owner_id AS "ownerId", name
       FROM playlists
       WHERE owner_id = $1 AND (playlist_id::text = $2 OR lower(name) = lower($2))
       LIMIT 1`,
      [ownerId, nameOrId],
    );
    const playlist = result.rows[0];
    if (!playlist) throw new Error("Playlist not found or you do not own it.");
    return playlist;
  }

  async addTrack(ownerId: string, nameOrId: string, track: MusicTrack): Promise<number> {
    const playlist = await this.findOwned(ownerId, nameOrId);
    return this.database.transaction(async (client) => {
      const count = await client.query<{ total: number }>(
        "SELECT COUNT(*)::integer AS total FROM playlist_tracks WHERE playlist_id = $1",
        [playlist.playlistId],
      );
      const position = count.rows[0]?.total ?? 0;
      if (position >= this.maxTracks) throw new Error(`Playlist limit reached (${this.maxTracks} tracks).`);
      await client.query(
        "INSERT INTO playlist_tracks (playlist_id, position, track_data) VALUES ($1, $2, $3::jsonb)",
        [playlist.playlistId, position, JSON.stringify(track)],
      );
      await client.query("UPDATE playlists SET updated_at = NOW() WHERE playlist_id = $1", [playlist.playlistId]);
      return position + 1;
    });
  }

  async removeTrack(ownerId: string, nameOrId: string, position: number): Promise<void> {
    const playlist = await this.findOwned(ownerId, nameOrId);
    await this.database.transaction(async (client) => {
      await requireTrackPosition(client, playlist.playlistId, position);
      await client.query("DELETE FROM playlist_tracks WHERE playlist_id = $1 AND position = $2", [
        playlist.playlistId,
        position - 1,
      ]);
      await normalizeStoredPositions(client, playlist.playlistId);
    });
  }

  async reorder(ownerId: string, nameOrId: string, from: number, to: number): Promise<void> {
    const playlist = await this.findOwned(ownerId, nameOrId);
    await this.database.transaction(async (client) => {
      const tracks = await client.query<{ track_data: MusicTrack }>(
        "SELECT track_data FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC",
        [playlist.playlistId],
      );
      const reordered = reorderPositions(tracks.rows.map((row) => row.track_data), from, to);
      await client.query("DELETE FROM playlist_tracks WHERE playlist_id = $1", [playlist.playlistId]);
      for (const [index, track] of reordered.entries()) {
        await client.query(
          "INSERT INTO playlist_tracks (playlist_id, position, track_data) VALUES ($1, $2, $3::jsonb)",
          [playlist.playlistId, index, JSON.stringify(track)],
        );
      }
    });
  }

  async tracks(ownerId: string, nameOrId: string, page = 1, pageSize = 10): Promise<TrackPage<MusicTrack>> {
    validatePage(page, pageSize);
    const playlist = await this.findOwned(ownerId, nameOrId);
    const [count, rows] = await Promise.all([
      this.database.query<{ total: string }>(
        "SELECT COUNT(*)::text AS total FROM playlist_tracks WHERE playlist_id = $1",
        [playlist.playlistId],
      ),
      this.database.query<{ track_data: MusicTrack }>(
        `SELECT track_data FROM playlist_tracks WHERE playlist_id = $1
         ORDER BY position ASC LIMIT $2 OFFSET $3`,
        [playlist.playlistId, pageSize, (page - 1) * pageSize],
      ),
    ]);
    return makePage(
      rows.rows.map((row) => row.track_data),
      page,
      pageSize,
      Number(count.rows[0]?.total ?? 0),
    );
  }
}

async function requireTrackPosition(client: PoolClient, playlistId: string, position: number): Promise<void> {
  const result = await client.query(
    "SELECT 1 FROM playlist_tracks WHERE playlist_id = $1 AND position = $2",
    [playlistId, position - 1],
  );
  if (!result.rowCount) throw new RangeError("Track position is outside the playlist.");
}

async function normalizeStoredPositions(client: PoolClient, playlistId: string): Promise<void> {
  const rows = await client.query<{ track_data: MusicTrack }>(
    "SELECT track_data FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC",
    [playlistId],
  );
  await client.query("DELETE FROM playlist_tracks WHERE playlist_id = $1", [playlistId]);
  for (const [position, row] of rows.rows.entries()) {
    await client.query(
      "INSERT INTO playlist_tracks (playlist_id, position, track_data) VALUES ($1, $2, $3::jsonb)",
      [playlistId, position, JSON.stringify(row.track_data)],
    );
  }
}

function validatePage(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new RangeError("Page and page size must be positive integers; page size cannot exceed 50.");
  }
}

function makePage<T>(items: T[], page: number, pageSize: number, total: number): TrackPage<T> {
  const pages = Math.ceil(total / pageSize);
  return { items, page, pageSize, total, pages };
}