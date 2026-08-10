export interface Env {
  TASK_DB: D1Database;
  ASSETS: Fetcher;
  DISCORD_APPLICATION_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  DISCORD_ADMIN_ROLE_ID: string;
  DISCORD_ASSIGNEE_ROLE_IDS: string;
  TASK_NOTIFICATION_CHANNEL_ID: string;
  DASHBOARD_BASE_URL: string;
  SESSION_SECRET: string;
  TASK_API_SHARED_SECRET: string;
}

export interface SessionUser {
  id: string;
  username: string;
  avatarUrl: string | null;
  csrfToken: string;
}

export type Variables = {
  user: SessionUser;
  sessionHash: string;
};

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ReportStatus = 'not_started' | 'in_progress' | 'completed';

export interface DiscordMember {
  user?: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
    bot?: boolean;
  };
  nick?: string | null;
  roles: string[];
}

export interface OutboxRow {
  id: string;
  kind: 'assignment_channel' | 'assignment_dm' | 'report_request_dm' | 'overdue_dm' | 'report_channel';
  task_id: string;
  user_id: string | null;
  reference_id: string | null;
  attempts: number;
}
