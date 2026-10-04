export interface TrackInfo {
  identifier?: string;
  title: string;
  author?: string;
  length?: number;
  duration?: number;
  uri?: string;
  sourceName?: string;
  artworkUrl?: string;
  isSeekable?: boolean;
  isStream?: boolean;
}

export interface MusicTrack {
  encoded?: string;
  info: TrackInfo;
  userData?: Record<string, unknown>;
  pluginInfo?: Record<string, unknown>;
  requester?: unknown;
}

export interface TrackPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export function trackKey(track: MusicTrack): string {
  return track.encoded || track.info.uri || `${track.info.sourceName ?? ""}:${track.info.identifier ?? track.info.title}`;
}

export function trackDuration(track: MusicTrack): number {
  return track.info.isStream ? 0 : Math.max(0, track.info.duration ?? track.info.length ?? 0);
}

export function trackRequester(track: MusicTrack): string | undefined {
  const requester = track.userData?.requesterId;
  return typeof requester === "string" ? requester : undefined;
}