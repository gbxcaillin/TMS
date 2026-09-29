import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

export const roleEnum = pgEnum('role', ['adviser', 'paraplanner', 'admin', 'support']);
export const clientTypeEnum = pgEnum('client_type', ['individual', 'couple', 'smsf', 'trust', 'company']);
export const clientStatusEnum = pgEnum('client_status', ['prospect', 'active', 'inactive']);
export const taskStatusEnum = pgEnum('task_status', ['todo', 'in_progress', 'waiting', 'done']);
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'normal', 'high']);
export const runStatusEnum = pgEnum('run_status', ['queued', 'running', 'awaiting_review', 'completed', 'failed', 'cancelled']);
export const documentStatusEnum = pgEnum('document_status', ['draft', 'approved', 'rejected']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull().default('support'),
  /** Entra ID object id (oid claim). */
  msOid: text('ms_oid'),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email), uniqueIndex('users_ms_oid_idx').on(t.msOid)]);

export const sessions = pgTable('sessions', {
  /** sha256 of the opaque cookie token; the raw token is never stored. */
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

/** Encrypted MSAL token cache per user (AES-256-GCM, key from TOKEN_ENCRYPTION_KEY). */
export const msTokenCaches = pgTable('ms_token_caches', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  homeAccountId: text('home_account_id').notNull(),
  cipherText: text('cipher_text').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: clientTypeEnum('type').notNull().default('individual'),
  status: clientStatusEnum('status').notNull().default('active'),
  /** All email addresses associated with the client; used to link Outlook mail and meetings. */
  emails: text('emails').array().notNull().default([]),
  phone: text('phone'),
  adviserId: uuid('adviser_id').references(() => users.id, { onDelete: 'set null' }),
  platform: text('platform'),
  fum: money('fum'),
  ongoingFee: money('ongoing_fee'),
  reviewMonth: integer('review_month'),
  nextReviewDate: date('next_review_date', { mode: 'string' }),
  ofaRenewalDate: date('ofa_renewal_date', { mode: 'string' }),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('clients_name_idx').on(t.name), index('clients_emails_idx').using('gin', t.emails)]);

export const clientNotes = pgTable('client_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('client_notes_client_idx').on(t.clientId, t.createdAt)]);

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  notes: text('notes'),
  status: taskStatusEnum('status').notNull().default('todo'),
  priority: taskPriorityEnum('priority').notNull().default('normal'),
  dueDate: date('due_date', { mode: 'string' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  completedAt: ts('completed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('tasks_assignee_idx').on(t.assigneeId, t.status), index('tasks_client_idx').on(t.clientId)]);

export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  graphId: text('graph_id').notNull(),
  subject: text('subject').notNull().default(''),
  start: ts('start').notNull(),
  end: ts('end').notNull(),
  location: text('location'),
  isOnline: boolean('is_online').notNull().default(false),
  attendees: jsonb('attendees').$type<{ name: string; email: string }[]>().notNull().default([]),
  bodyPreview: text('body_preview'),
  webLink: text('web_link'),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('calendar_events_graph_idx').on(t.userId, t.graphId), index('calendar_events_start_idx').on(t.userId, t.start), index('calendar_events_client_idx').on(t.clientId)]);

export const emails = pgTable('emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  graphId: text('graph_id').notNull(),
  conversationId: text('conversation_id'),
  subject: text('subject').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  to: text('to').array().notNull().default([]),
  cc: text('cc').array().notNull().default([]),
  preview: text('preview').notNull().default(''),
  /** Plain-text body, kept so the annual review can read the year's correspondence. */
  bodyText: text('body_text'),
  receivedAt: ts('received_at').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  hasAttachments: boolean('has_attachments').notNull().default(false),
  webLink: text('web_link'),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
}, (t) => [uniqueIndex('emails_graph_idx').on(t.userId, t.graphId), index('emails_received_idx').on(t.userId, t.receivedAt), index('emails_client_idx').on(t.clientId, t.receivedAt)]);

/** Graph delta links so each sync only fetches changes. */
export const graphSyncState = pgTable('graph_sync_state', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  resource: text('resource').notNull(),
  deltaLink: text('delta_link'),
  lastSyncedAt: ts('last_synced_at'),
  lastError: text('last_error'),
}, (t) => [primaryKey({ columns: [t.userId, t.resource] })]);

export const chatChannels = pgTable('chat_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('chat_channels_name_idx').on(t.name)]);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  channelId: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('chat_messages_channel_idx').on(t.channelId, t.createdAt)]);

export const chatReads = pgTable('chat_reads', {
  channelId: uuid('channel_id').notNull().references(() => chatChannels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: ts('last_read_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] })]);

export const toolRuns = pgTable('tool_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tool: text('tool').notNull(),
  status: runStatusEnum('status').notNull().default('queued'),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
  summary: text('summary'),
  error: text('error'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4, mode: 'number' }),
  agentSessionId: text('agent_session_id'),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
}, (t) => [index('tool_runs_client_idx').on(t.clientId, t.createdAt), index('tool_runs_created_idx').on(t.createdAt)]);

export const toolRunEvents = pgTable('tool_run_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').notNull().references(() => toolRuns.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'status' | 'progress' | 'tool' | 'text' | 'error' | 'result'>().notNull(),
  message: text('message').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('tool_run_events_run_idx').on(t.runId, t.id)]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => toolRuns.id, { onDelete: 'set null' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  filename: text('filename').notNull(),
  /** Path relative to DATA_DIR. */
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  status: documentStatusEnum('status').notNull().default('draft'),
  approvedById: uuid('approved_by_id').references(() => users.id),
  approvedAt: ts('approved_at'),
  reviewComment: text('review_comment'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('documents_client_idx').on(t.clientId), index('documents_run_idx').on(t.runId)]);

/** Append-only record of who did what, for licensee / ASIC record-keeping. */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>(),
  ip: text('ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId), index('audit_log_created_idx').on(t.createdAt)]);
