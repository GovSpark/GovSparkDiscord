export interface User {
  id: string;
  username: string;
  avatarUrl: string | null;
  csrfToken: string;
}

export interface Member {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export type TaskStatus = 'active' | 'awaiting_report' | 'awaiting_next_due' | 'completed' | 'cancelled' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ReportStatus = 'not_started' | 'in_progress' | 'completed';

export interface Assignee {
  taskId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  completedAt: string | null;
}

export interface Report {
  id: string;
  taskId: string;
  roundId: string;
  userId: string;
  status: ReportStatus;
  details: string;
  revision: number;
  submittedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  dueAt: string;
  priority: Priority;
  relatedUrl: string | null;
  status: TaskStatus;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  currentRoundId: string;
  currentReportDueAt: string;
  notificationFailures: number;
  assignees: Assignee[];
  reports: Report[];
}

let csrfToken = '';

export function setCsrfToken(value: string) {
  csrfToken = value;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { 'x-csrf-token': csrfToken } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
  if (!response.ok) throw new ApiError(response.status, body?.error || `HTTP ${response.status}`);
  return body as T;
}

export class ApiError extends Error {
  public constructor(public readonly status: number, message: string) { super(message); }
}
