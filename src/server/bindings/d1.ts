import { type Auth, cloudflareFetch } from "./mod.ts";

class D1PreparedStatementImpl implements D1PreparedStatement {
  constructor(
    private db: D1DatabaseImpl,
    public statement: string,
    public params?: unknown[],
  ) {}

  bind(...values: unknown[]) {
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
    if (response instanceof Error) throw response;
    else if (!response.success) {
      throw new Error("D1 query error", { cause: response });
    } else return response.result;
  }

  prepare(query: string) {
    return new D1PreparedStatementImpl(this, query);
  }
  batch<T>(statements: D1PreparedStatementImpl[]) {
    if (statements.some((s) => s.params?.length)) {
      throw new Error(
        "D1.batch(): Prepared statements with bound parameters are not yet supported in batch operations",
      ); // TODO
    }

    return this.query<T>(statements.map((s) => s.statement).join(";"));
  }
  async exec(query: string) {
    const queries = query.trim().split("\n");
    const result = await this.query<unknown>(queries.join(";"));
    return { count: queries.length, duration: result[0].meta.duration };
  }
  withSession(constraintOrBookmark?: string): D1DatabaseSession {
    throw new Error("D1.withSession() is not yet supported"); // TODO
  }
  dump(): Promise<ArrayBuffer> {
    throw new Error("`dump()` not implemented as deprecated");
  }
}
