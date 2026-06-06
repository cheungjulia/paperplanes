import { API_URL } from '../config/env';
import type { PlaneKind, PlaneMemory, PlaneVisibility } from '../types/memory';
import { getAnonymousUserId } from './anonymousId';

interface CreateMemoryInput {
  body: string;
  linkUrl?: string;
  sketchJson?: string;
  photoBase64?: string;
  photoMimeType?: string;
  authorName?: string;
  kind?: PlaneKind;
  recipientName?: string;
  arrivesAt?: string;
  originLatitude?: number;
  originLongitude?: number;
  visibility: PlaneVisibility;
  latitude: number;
  longitude: number;
  geohash: string;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const anonymousUserId = await getAnonymousUserId();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'X-Anonymous-User-Id': anonymousUserId,
      ...(options.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed with ${response.status}`);
  }
  return data;
}

export async function fetchMemories(): Promise<PlaneMemory[]> {
  const data = await apiFetch('/api/memories');
  return data.memories ?? [];
}

export async function createMemory(input: CreateMemoryInput): Promise<PlaneMemory> {
  const data = await apiFetch('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: input.body,
      link_url: input.linkUrl,
      sketch_json: input.sketchJson ?? '[]',
      photo_base64: input.photoBase64,
      photo_mime_type: input.photoMimeType,
      author_name: input.authorName,
      kind: input.kind,
      recipient_name: input.recipientName,
      arrives_at: input.arrivesAt,
      origin_latitude: input.originLatitude,
      origin_longitude: input.originLongitude,
      visibility: input.visibility,
      latitude: input.latitude,
      longitude: input.longitude,
      geohash: input.geohash,
    }),
  });
  return data.memory;
}

export async function echoMemory(memoryId: string, enabled: boolean): Promise<{ echo_count: number; echoed_by_me: boolean }> {
  return apiFetch(`/api/memories/${memoryId}/echo`, {
    method: enabled ? 'POST' : 'DELETE',
  });
}
