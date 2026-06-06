export type PlaneVisibility = 'folded' | 'free';
export type PlaneKind = 'private' | 'public' | 'directed';

export interface PlaneMemory {
  id: string;
  kind?: PlaneKind;
  body: string;
  link_url: string | null;
  sketch_json: string;
  photo_base64: string | null;
  photo_mime_type: string | null;
  author_name: string | null;
  visibility: PlaneVisibility;
  recipient_name: string | null;
  arrives_at: string | null;
  origin_latitude: number | null;
  origin_longitude: number | null;
  latitude: number;
  longitude: number;
  geohash: string;
  created_at: string;
  echo_count: number;
  echoed_by_me: boolean;
  mine: boolean;
}

export interface SketchStroke {
  id: string;
  points: { x: number; y: number }[];
}
