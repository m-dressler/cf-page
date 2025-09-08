import { isError } from "@md/ensure-error/is-error";
import { type Auth, cloudflareFetch } from "./mod.ts";

/** Splits a list of queries into individual queries */
const parseQueries = (query: string): string[] =>
  query.trim().split(";").map((q) => q.trim()).filter((q) => q.length > 0);

/** Base D1PreparedStatement implementation with shared functionality */
class D1PreparedStatementImpl implements D1PreparedStatement {
  constructor(
    private db: D1DatabaseImpl,
    public statement: string,
    public params?: unknown[],
  ) {}

  public bind(...values: unknown[]) {
    for (const key in values) {
      const value = values[key];
      switch (typeof value) {
        case "number":
        case "string":
          break;
        case "object":
          if (value == null) break;
          if (
            Array.isArray(value) &&
            value
                .map((b) => {
                  return typeof b == "number" && b >= 0 && b < 256 ? 1 : 0;
                })
                .indexOf(0) == -1
          ) {
            break;
          }
          if (value instanceof ArrayBuffer) {
            values[key] = Array.from(new Uint8Array(value));
            break;
          }
          if (ArrayBuffer.isView(value)) {
            values[key] = Array.from(new Uint8Array(value.buffer));
            break;
          }
        /** Falls through */
        default:
          throw new Error(
            `D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${value}'`,
            {
              cause: new Error(
                `Type '${typeof value}' not supported for value '${value}'`,
              ),
            },
          );
      }
    }
    return new D1PreparedStatementImpl(this.db, this.statement, values);
  }

  async run<T>() {
    const results = await this.db.query<T>(this.statement, this.params);
    return results[0];
  }

  async first<T = Record<string, unknown>>(
    colName?: string,
  ): Promise<T | null> {
    const results = await this.db.query<T>(this.statement, this.params);
    const first = results[0].results[0];
    if (colName == null) return first ?? null;

    return ((first as Record<string, unknown>)?.[colName] as T) ?? null;
  }

  async all<T>() {
    const results = await this.db.query<T>(this.statement, this.params);
    return results[0];
  }

  async raw<T extends []>(options?: {
    columnNames?: boolean;
  }): Promise<[string[], ...T[]] & T[]> {
    const response = await this.db.query<T, "raw">(
      this.statement,
      this.params,
      "raw",
    );
    const { rows, columns } = response[0].results;
    if (!options?.columnNames) return rows as [string[], ...T[]] & T[];
    else return [columns, ...rows] as [string[], ...T[]] & T[];
  }
}

/** Remote D1Database fetching via API */
export class D1DatabaseImpl implements D1Database {
  constructor(public id: string, public auth: Auth) {}

  async query<T, Mode extends "query" | "raw" = "query">(
    sql: string,
    params?: unknown[],
    mode?: Mode,
  ) {
    const response = await cloudflareFetch<{
      result: Mode extends "raw"
        ? Array<D1Response & { results: { columns: string[]; rows: T[] } }>
        : D1Result<T>[];
      messages: unknown[];
      errors: unknown[];
      success: boolean;
    }>(
      `/accounts/${this.auth.accountId}/d1/database/${this.id}/${
        mode ?? "query"
      }`,
      this.auth.apiToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
      },
    );
    if (isError(response)) throw response;
    else if (!response.success) {
      throw new Error("D1 query error", { cause: response });
    } else return response.result;
  }

  prepare(query: string) {
    return new D1PreparedStatementImpl(this, query);
  }

  async batch<T>(
    statements: D1PreparedStatementImpl[],
  ): Promise<D1Result<T>[]> {
    const promises = statements.map((s) => this.query<T>(s.statement));
    const results = await Promise.all(promises);
    return results.flat(1);
  }

  async exec(query: string) {
    const queries = parseQueries(query);
    const start = Date.now();
    for (const sql of queries) await this.query(sql);
    return { count: queries.length, duration: Date.now() - start };
  }

  withSession(_constraintOrBookmark?: string): D1DatabaseSession {
    throw new Error("D1.withSession() is not yet supported");
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("`dump()` not implemented as deprecated"));
  }
}
