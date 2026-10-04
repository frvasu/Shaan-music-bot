import type { MusicTrack, TrackPage } from "../types/Track.js";
import { trackKey } from "../types/Track.js";

export class QueueManager<T extends MusicTrack = MusicTrack> {
  private items: T[] = [];

  constructor(private readonly maxSize = 500, initial: T[] = []) {
    if (!Number.isInteger(maxSize) || maxSize < 1) throw new RangeError("Queue limit must be a positive integer.");
    if (initial.length > maxSize) throw new RangeError("Initial queue exceeds the configured queue limit.");
    this.items = [...initial];
  }

  get size(): number {
    return this.items.length;
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  get first(): T | undefined {
    return this.items[0];
  }

  get tracks(): readonly T[] {
    return this.items;
  }

  add(track: T, allowDuplicates = true): boolean {
    return this.addMany([track], allowDuplicates) === 1;
  }

  addMany(tracks: readonly T[], allowDuplicates = true): number {
    const additions: T[] = [];
    const keys = allowDuplicates ? undefined : new Set(this.items.map(trackKey));
    for (const track of tracks) {
      if (keys?.has(trackKey(track))) continue;
      additions.push(track);
      keys?.add(trackKey(track));
    }
    if (this.items.length + additions.length > this.maxSize) {
      throw new RangeError(`Queue limit reached (${this.maxSize} tracks).`);
    }
    this.items.push(...additions);
    return additions.length;
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  remove(position: number): T {
    const index = this.toIndex(position);
    return this.items.splice(index, 1)[0]!;
  }

  clear(): T[] {
    return this.items.splice(0);
  }

  move(from: number, to: number): void {
    const source = this.toIndex(from);
    const target = this.toIndex(to);
    const [track] = this.items.splice(source, 1);
    if (!track) throw new RangeError("Track position is outside the queue.");
    this.items.splice(target, 0, track);
  }

  swap(first: number, second: number): void {
    const a = this.toIndex(first);
    const b = this.toIndex(second);
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
  }

  jump(position: number): T {
    const targetIndex = this.toIndex(position);
    this.items.splice(0, targetIndex);
    return this.items[0]!;
  }

  skipTo(position: number): T {
    return this.jump(position);
  }

  shuffle(random: () => number = Math.random): void {
    for (let index = this.items.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [this.items[index], this.items[target]] = [this.items[target]!, this.items[index]!];
    }
  }

  reverse(): void {
    this.items.reverse();
  }

  page(page = 1, pageSize = 10): TrackPage<T> {
    if (!Number.isInteger(page) || page < 1) throw new RangeError("Page must be a positive integer.");
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("Page size must be a positive integer.");
    const pages = Math.ceil(this.items.length / pageSize);
    const validPage = Math.min(page, Math.max(pages, 1));
    const start = (validPage - 1) * pageSize;
    return {
      items: this.items.slice(start, start + pageSize),
      page: validPage,
      pageSize,
      total: this.items.length,
      pages,
    };
  }

  findByKey(key: string): number {
    return this.items.findIndex((track) => trackKey(track) === key);
  }

  toJSON(): T[] {
    return [...this.items];
  }

  private toIndex(position: number): number {
    if (!Number.isInteger(position) || position < 1 || position > this.items.length) {
      throw new RangeError(`Track position must be between 1 and ${this.items.length}.`);
    }
    return position - 1;
  }
}