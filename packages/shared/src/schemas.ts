import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const clientInput = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(['individual', 'couple', 'smsf', 'trust', 'company']),
  status: z.enum(['prospect', 'active', 'inactive']).default('active'),
  emails: z.array(z.string().email()).max(10).default([]),
  phone: z.string().max(40).nullable().optional(),
  adviserId: z.string().uuid().nullable().optional(),
  platform: z.string().max(100).nullable().optional(),
  fum: z.number().nonnegative().nullable().optional(),
  ongoingFee: z.number().nonnegative().nullable().optional(),
  reviewMonth: z.number().int().min(1).max(12).nullable().optional(),
  nextReviewDate: isoDate.nullable().optional(),
  ofaRenewalDate: isoDate.nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
});
export type ClientInput = z.infer<typeof clientInput>;

export const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(10000).nullable().optional(),
  status: z.enum(['todo', 'in_progress', 'waiting', 'done']).default('todo'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueDate: isoDate.nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

export const chatMessageInput = z.object({
  body: z.string().trim().min(1).max(8000),
  clientId: z.string().uuid().nullable().optional(),
});

export const channelInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
});

export const documentDecision = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(2000).optional(),
});
