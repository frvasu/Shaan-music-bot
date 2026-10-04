import type { Database } from "./Database.js";
import type { MusicSession, MusicSessionState } from "../music/MusicSession.js";
import type { MusicTrack } from "../types/Track.js";

export interface PersistedSession {
  guildId: string;
  voiceChannelId: string | null;
  textChannelId: string | null;
  sessionOwner: string | null;
  volume: number;
  loopMode: "off" | "track" | "queue";
  autoplay: boolean;
  stay247: boolean;
  currentTrack: MusicTrack | null;
  queue: MusicTrack[];
  positionMs: number;
  paused: boolean;
  updatedAt: Date;
}

export class MusicSessionStore {
  constructor(private readonly database: Database) {}

  async save(session: MusicSession): Promise<void> {
    const state = session.snapshot();
    await this.database.query(
      `INSERT INTO music_sessions
        (guild_id, voice_channel_id, text_channel_id, session_owner, volume, loop_mode, autoplay, stay_247, current_track, queue, position_ms, paused, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, NOW())
       ON CONFLICT (guild_id) DO UPDATE SET
         voice_channel_id = EXCLUDED.voice_channel_id,
         text_channel_id = EXCLUDED.text_channel_id,
         session_owner = EXCLUDED.session_owner,
         volume = EXCLUDED.volume,
         loop_mode = EXCLUDED.loop_mode,
         autoplay = EXCLUDED.autoplay,
         stay_247 = EXCLUDED.stay_247,
         current_track = EXCLUDED.current_track,
         queue = EXCLUDED.queue,
         position_ms = EXCLUDED.position_ms,
         paused = EXCLUDED.paused,
         updated_at = NOW()`,
      [
        state.guildId,
        state.voiceChannelId,
        state.textChannelId,
        state.sessionOwner,
        state.volume,
        state.loopMode,
        state.autoplay,
        state.stay247,
        JSON.stringify(state.currentTrack),
        JSON.stringify(state.queue),
        state.positionMs,
        state.paused,
      ],
    );
  }

  async loadAll(): Promise<PersistedSession[]> {
    const result = await this.database.query<{
      guild_id: string;
      voice_channel_id: string | null;
      text_channel_id: string | null;
      session_owner: string | null;
      volume: number;
      loop_mode: "off" | "track" | "queue";
      autoplay: boolean;
      stay_247: boolean;
      current_track: MusicTrack | null;
      queue: MusicTrack[];
      position_ms: number;
      paused: boolean;
      updated_at: Date;
    }>("SELECT * FROM music_sessions WHERE voice_channel_id IS NOT NULL ORDER BY updated_at DESC");
    return result.rows.map((row) => ({
      guildId: row.guild_id,
      voiceChannelId: row.voice_channel_id,
      textChannelId: row.text_channel_id,
      sessionOwner: row.session_owner,
      volume: row.volume,
      loopMode: row.loop_mode,
      autoplay: row.autoplay,
      stay247: row.stay_247,
      currentTrack: row.current_track,
      queue: row.queue ?? [],
      positionMs: row.position_ms,
      paused: row.paused,
      updatedAt: row.updated_at,
    }));
  }

  async remove(guildId: string): Promise<void> {
    await this.database.query("DELETE FROM music_sessions WHERE guild_id = $1", [guildId]);
  }
}

export function stateFromPersisted(session: PersistedSession): Partial<MusicSessionState> {
  return {
    guildId: session.guildId,
    voiceChannelId: session.voiceChannelId,
    textChannelId: session.textChannelId,
    sessionOwner: session.sessionOwner,
    volume: session.volume,
    loopMode: session.loopMode,
    autoplay: session.autoplay,
    stay247: session.stay247,
    currentTrack: session.currentTrack,
    positionMs: session.positionMs,
    paused: session.paused,
  };
}