/** Minimal D1 types for local type-checking. Wrangler supplies the runtime bindings. */
interface D1Meta {
  changes?: number;
  last_row_id?: number;
  duration?: number;
}
interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta: D1Meta;
  error?: string;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
declare module "bcryptjs" {
  const bcrypt: {
    hash(password: string, rounds: number): Promise<string>;
    compare(password: string, hash: string): Promise<boolean>;
  };
  export default bcrypt;
}
