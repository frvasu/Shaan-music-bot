export interface PermissionContext {
  guildId?: string | null;
  channelId?: string | null;
  userId: string;
  userIsAdmin?: boolean;
  userRoleIds?: readonly string[];
  userVoiceChannelId?: string | null;
  botVoiceChannelId?: string | null;
  sessionOwnerId?: string | null;
  djRoleId?: string | null;
  djChannelId?: string | null;
  allowedChannelIds?: readonly string[];
  blockedChannelIds?: readonly string[];
  isPremium?: boolean;
}

export class PermissionService {
  constructor(private readonly ownerIds: ReadonlySet<string>) {}

  requireGuild(context: PermissionContext): string {
    if (!context.guildId) throw new Error("This command can only be used in a server.");
    this.requireAllowedChannel(context);
    return context.guildId;
  }

  requireVoice(context: PermissionContext): string {
    if (!context.userVoiceChannelId) throw new Error("Join a voice channel first.");
    return context.userVoiceChannelId;
  }

  requireSameVoice(context: PermissionContext): void {
    const userChannel = this.requireVoice(context);
    if (context.botVoiceChannelId && context.botVoiceChannelId !== userChannel) {
      throw new Error("Join the voice channel I am using to control this session.");
    }
  }

  requireDJ(context: PermissionContext): void {
    this.requireSameVoice(context);
    if (this.isOwner(context.userId) || context.userIsAdmin) return;
    const hasConfiguredDjRole = Boolean(context.djRoleId);
    const hasDjRole = Boolean(context.djRoleId && context.userRoleIds?.includes(context.djRoleId));
    if (hasConfiguredDjRole && !hasDjRole) throw new Error("You need the configured DJ role to control playback.");
    if (context.sessionOwnerId && context.sessionOwnerId !== context.userId && !hasDjRole) {
      throw new Error("Only the session owner or a DJ can control this session.");
    }
    if (!context.sessionOwnerId && hasConfiguredDjRole && !hasDjRole) {
      throw new Error("You need the configured DJ role to control playback.");
    }
  }

  requireAdmin(context: PermissionContext): void {
    this.requireGuild(context);
    if (!context.userIsAdmin && !this.isOwner(context.userId)) {
      throw new Error("You need the server administrator permission to change these settings.");
    }
  }

  requireOwner(userId: string): void {
    if (!this.isOwner(userId)) throw new Error("This command is limited to bot owners.");
  }

  requirePremium(context: PermissionContext): void {
    if (!context.isPremium && !this.isOwner(context.userId)) {
      throw new Error("This feature requires an active premium entitlement.");
    }
  }

  isOwner(userId: string): boolean {
    return this.ownerIds.has(userId);
  }

  private requireAllowedChannel(context: PermissionContext): void {
    if (context.channelId && context.blockedChannelIds?.includes(context.channelId)) {
      throw new Error("Music commands are disabled in this channel.");
    }
    if (
      context.allowedChannelIds?.length &&
      context.channelId &&
      !context.allowedChannelIds.includes(context.channelId)
    ) {
      throw new Error("Use one of the server's allowed music channels.");
    }
    if (context.djChannelId && context.channelId !== context.djChannelId) {
      // The DJ channel restricts DJ controls; regular commands can still use an allowed channel.
      return;
    }
  }
}