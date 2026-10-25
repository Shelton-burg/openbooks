interface D1Result {
  results: any[];
  success?: boolean;
  meta: {changes: number};
}
interface D1PreparedStatement {
  bind(...args: any[]): D1PreparedStatement;
  all<T = any>(): Promise<{results: T[]}>;
  first<T = any>(): Promise<T | null>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(items: D1PreparedStatement[]): Promise<D1Result[]>;
}
interface R2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: unknown): Promise<unknown>;
  get(key: string): Promise<{
    body: Uint8Array<ArrayBuffer>;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  delete(key: string): Promise<unknown>;
}
