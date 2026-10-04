import { QueueManager } from "../queue/QueueManager.js";
import type { MusicTrack } from "../types/Track.js";

export type LoopMode = "off" | "track" | "queue";

export interface PlaybackPort {
  play(track: MusicTrack): Promise<void>;
  pause(paused: boolean): Promise<void>;
  stop(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
}

export interface MusicSessionState {
  guildId: string;
  voiceChannelId: string | null;
  textChannelId: string | null;
  sessionOwner: string | null;
  volume: number;
  loopMode: LoopMode;
  autoplay: boolean;
  stay247: boolean;
  currentTrack: MusicTrack | null;
  positionMs: number;
  startedAt: number | null;
  paused: boolean;
  filters: Record<string, unknown>;
}

export class MusicSession {
  readonly queue: QueueManager<MusicTrack>;
  readonly state: MusicSessionState;
  player: PlaybackPort | null = null;

  constructor(guildId: string, maxQueueSize = 500, state?: Partial<MusicSessionState>, queue: MusicTrack[] = []) {
    this.queue = new QueueManager(maxQueueSize, queue);
    this.state = {
      guildId,
      voiceChannelId: null,
      textChannelId: null,
      sessionOwner: null,
      volume: 80,
      loopMode: "off",
      autoplay: false,
      stay247: false,
      currentTrack: null,
      positionMs: 0,
      startedAt: null,
      paused: false,
      filters: {},
      ...state,
    };
  }

  get guildId(): string {
    return this.state.guildId;
  }

  attachPlayer(player: PlaybackPort): void {
    this.player = player;
  }

  async start(track: MusicTrack): Promise<void> {
    if (!this.player) throw new Error("No Lavalink player is attached to this session.");
    this.state.currentTrack = track;
    this.state.positionMs = 0;
    this.state.startedAt = Date.now();
    this.state.paused = false;
    await this.player.play(track);
  }

  async pause(): Promise<void> {
    if (!this.player || !this.state.currentTrack) throw new Error("There is no active track to pause.");
    await this.player.pause(true);
    this.state.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.player || !this.state.currentTrack) throw new Error("There is no active track to resume.");
    await this.player.pause(false);
    this.state.paused = false;
  }

  async seek(positionMs: number): Promise<void> {
    const duration = this.state.currentTrack?.info.length;
    if (!this.player || !this.state.currentTrack) throw new Error("There is no active track to seek.");
    if (!Number.isFinite(positionMs) || positionMs < 0 || (duration && positionMs > duration)) {
      throw new RangeError("Seek position is outside the track duration.");
    }
    await this.player.seek(positionMs);
    this.state.positionMs = positionMs;
    this.state.startedAt = Date.now() - positionMs;
  }

  async setVolume(volume: number): Promise<void> {
    if (!Number.isInteger(volume) || volume < 0 || volume > 200) {
      throw new RangeError("Volume must be between 0 and 200.");
    }
    if (this.player) await this.player.setVolume(volume);
    this.state.volume = volume;
  }

  async stop(): Promise<void> {
    if (this.player) await this.player.stop();
    this.queue.clear();
    this.state.currentTrack = null;
    this.state.positionMs = 0;
    this.state.startedAt = null;
    this.state.paused = false;
  }

  async nextTrack(force = false): Promise<MusicTrack | undefined> {
    if (!force && this.state.loopMode === "track" && this.state.currentTrack) {
      if (this.player) await this.player.play(this.state.currentTrack);
      this.state.positionMs = 0;
      this.state.startedAt = Date.now();
      this.state.paused = false;
      return this.state.currentTrack;
    }
    const next = this.queue.dequeue();
    if (this.state.loopMode === "queue" && this.state.currentTrack) this.queue.add(this.state.currentTrack);
    this.state.currentTrack = next ?? null;
    this.state.positionMs = 0;
    this.state.startedAt = next ? Date.now() : null;
    this.state.paused = false;
    if (next && this.player) await this.player.play(next);
    return next;
  }

  claim(userId: string): void {
    if (!userId) throw new Error("Session owner ID is required.");
    this.state.sessionOwner = userId;
  }

  transfer(fromUserId: string, toUserId: string): void {
    if (this.state.sessionOwner !== fromUserId) throw new Error("Only the session owner can transfer ownership.");
    if (!toUserId) throw new Error("Target user ID is required.");
    this.state.sessionOwner = toUserId;
  }

  setLoop(mode: LoopMode): void {
    this.state.loopMode = mode;
  }

  setAutoplay(enabled: boolean): void {
    this.state.autoplay = enabled;
  }

  setStay247(enabled: boolean): void {
    this.state.stay247 = enabled;
  }

  snapshot(): MusicSessionState & { queue: MusicTrack[] } {
    return { ...this.state, queue: this.queue.toJSON(), filters: { ...this.state.filters } };
  }
}

export class MusicSessionRegistry {
  private readonly sessions = new Map<string, MusicSession>();

  constructor(private readonly maxQueueSize: number) {}

  get(guildId: string): MusicSession | undefined {
    return this.sessions.get(guildId);
  }

  getOrCreate(guildId: string, state?: Partial<MusicSessionState>, queue?: MusicTrack[]): MusicSession {
    let session = this.sessions.get(guildId);
    if (!session) {
      session = new MusicSession(guildId, this.maxQueueSize, state, queue);
      this.sessions.set(guildId, session);
    }
    return session;
  }

  delete(guildId: string): boolean {
    return this.sessions.delete(guildId);
  }

  values(): IterableIterator<MusicSession> {
    return this.sessions.values();
  }

  get size(): number {
    return this.sessions.size;
  }
}