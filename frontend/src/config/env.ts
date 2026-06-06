import { Platform } from 'react-native';

function resolveLocalhost(url: string): string {
  if (Platform.OS === 'android' && __DEV__) {
    return url.replace('://localhost', '://10.0.2.2');
  }
  return url;
}

export const API_URL = resolveLocalhost(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8008');

