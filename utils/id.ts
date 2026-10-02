import { randomUUID } from 'expo-crypto';

// RFC 4122 v4 UUID; safe for ids created in quick succession (unlike Date.now()).
export function newId(): string {
  return randomUUID();
}
