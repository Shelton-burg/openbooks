import {getDatabase} from '../server/storage.mjs';
export function db() {
  return getDatabase() as unknown as D1Database;
}
