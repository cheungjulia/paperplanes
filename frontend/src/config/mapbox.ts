import Mapbox from '@rnmapbox/maps';

export const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
export const MAPBOX_STYLE_URL =
  process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL ?? 'mapbox://styles/dasprasky/cmq1r5r42003001rfhfkx3yzc';

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);

