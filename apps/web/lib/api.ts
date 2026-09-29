import type { ChatMessage, ToolRunEvent } from '@tms/shared';
import { mockRequest, mockChatFeed, mockRunFeed } from './mock';

/** Demo mode runs the whole UI against in-browser sample data; no API needed. */
export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Body = FormData | Record<string, unknown> | undefined;

export async function api<T>(path: string, init: { method?: string; body?: Body } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  if (DEMO) return mockRequest<T>(method, path, init.body);
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: init.body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? (isForm ? (init.body as FormData) : JSON.stringify(init.body)) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Live progress for a tool run. Returns an unsubscribe function. */
export function subscribeRunEvents(runId: string, onEvent: (ev: ToolRunEvent) => void): () => void {
  if (DEMO) return mockRunFeed(runId, onEvent);
  const source = new EventSource(`/api/runs/${runId}/events`, { withCredentials: true });
  source.onmessage = (e) => onEvent(JSON.parse(e.data) as ToolRunEvent);
  return () => source.close();
}

/** Live practice chat. Returns an unsubscribe function. */
export function subscribeChat(onMessage: (m: ChatMessage) => void): () => void {
  if (DEMO) return mockChatFeed(onMessage);
  const origin = process.env.NEXT_PUBLIC_WS_ORIGIN ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 1000;
  const connect = () => {
    socket = new WebSocket(`${origin}/api/chat/ws`);
    socket.onopen = () => (retry = 1000);
    socket.onmessage = (e) => onMessage(JSON.parse(e.data as string) as ChatMessage);
    socket.onclose = () => {
      if (closed) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30_000);
    };
  };
  connect();
  return () => {
    closed = true;
    socket?.close();
  };
}

export function downloadUrl(documentId: string) {
  return DEMO ? null : `/api/documents/${documentId}/download`;
}
