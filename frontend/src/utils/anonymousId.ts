import * as SecureStore from 'expo-secure-store';

const KEY = 'fold.anonymousUserId';

export async function getAnonymousUserId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY);
  if (existing) return existing;
  const id = randomUuid();
  await SecureStore.setItemAsync(KEY, id);
  return id;
}

function randomUuid(): string {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (Number(char) ^ (random >> (Number(char) / 4))).toString(16);
  });
}
