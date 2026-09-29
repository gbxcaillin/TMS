export type Role = 'adviser' | 'paraplanner' | 'admin' | 'support';

export type ClientType = 'individual' | 'couple' | 'smsf' | 'trust' | 'company';
export type ClientStatus = 'prospect' | 'active' | 'inactive';
export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';
export type RunStatus = 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
export type DocumentStatus = 'draft' | 'approved' | 'rejected';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  initials: string;
  msConnected?: boolean;
}

export interface Client {
  id: string;
  name: string;
  type: ClientType;
  status: ClientStatus;
  emails: string[];
  phone: string | null;
  adviserId: string | null;
  adviserName?: string | null;
  platform: string | null;
  fum: number | null;
  ongoingFee: number | null;
  reviewMonth: number | null;
  nextReviewDate: string | null;
  ofaRenewalDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  clientId: string | null;
  clientName?: string | null;
  assigneeId: string | null;
  assigneeName?: string | null;
  createdAt: string;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string | null;
  isOnline: boolean;
  attendees: { name: string; email: string }[];
  clientId: string | null;
  clientName?: string | null;
  webLink: string | null;
}

export interface EmailMessage {
  id: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  to: string[];
  preview: string;
  receivedAt: string;
  isRead: boolean;
  hasAttachments: boolean;
  clientId: string | null;
  clientName?: string | null;
  webLink: string | null;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string | null;
  clientId: string | null;
  unread?: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  clientId?: string | null;
}

export interface ToolRun {
  id: string;
  tool: string;
  status: RunStatus;
  clientId: string | null;
  clientName?: string | null;
  inputs: Record<string, unknown>;
  summary: string | null;
  error: string | null;
  costUsd: number | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
  finishedAt: string | null;
  documents?: DocumentRecord[];
}

export interface ToolRunEvent {
  id: number;
  runId: string;
  kind: 'status' | 'progress' | 'tool' | 'text' | 'error' | 'result';
  message: string;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  runId: string | null;
  clientId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  approvedByName?: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  meetingsToday: CalendarEvent[];
  tasksDue: Task[];
  unreadEmails: EmailMessage[];
  reviewsDue: Client[];
  recentRuns: ToolRun[];
  stats: { clients: number; fum: number; reviewsThisMonth: number; openTasks: number };
}
