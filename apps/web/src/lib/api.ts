// Typed API client. Reads bearer token from localStorage. Throws ApiError with
// status + reason so pages can render structured error states (not toast-only).
//
// Base URL:
//   dev: '' (same-origin via Vite proxy at /api)
//   prod: VITE_API_URL injected at build time (defaults to /api)

import { getApiKey } from './auth';

const BASE = ((import.meta as any).env?.VITE_API_URL ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: any;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Skip the bearer header (used by the auth probe before login). */
  noAuth?: boolean;
  /** Return the raw Response for downloads / streaming. */
  raw?: boolean;
}

export async function api<T = any>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  if (!opts.noAuth) {
    const key = getApiKey();
    if (key) headers['Authorization'] = `Bearer ${key}`;
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (opts.raw) return res as any;

  let data: any = null;
  const ctype = res.headers.get('content-type') ?? '';
  if (ctype.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const reason =
      (data && typeof data === 'object' && (data.message || data.reason)) ||
      (typeof data === 'string' ? data : `HTTP ${res.status}`);
    throw new ApiError(Array.isArray(reason) ? reason.join(', ') : reason, res.status, data);
  }
  return data;
}

export function downloadUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(BASE + path, window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}
