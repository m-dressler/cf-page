import {
  DatabaseSync,
  type StatementResultingChanges,
  type SupportedValueType,
} from "node:sqlite";
import { D1DatabaseImpl } from "./d1.ts";

/** Local sqlite database via node:sqlite connector */
export class D1DatabaseLocal extends D1DatabaseImpl {
  private readonly db: DatabaseSync;
  private static readonly BASE_META = {
    served_by: "sqlite",
    served_by_primary: true,
    served_by_region: "LOCAL",
  };

  constructor(public path: string) {
    super(path, { accountId: "", apiToken: "" });
    this.db = new DatabaseSync(path);
  }

  // deno-lint-ignore require-await -- We need to return a promise even though this is sync
  override async query<T, Mode extends "query" | "raw" = "query">(
    sql: string,
    params: SupportedValueType[] = [],
    mode?: Mode,
  ): Promise<
    Mode extends "raw"
      ? Array<D1Response & { results: { columns: string[]; rows: T[] } }>
      : D1Result<T>[]
  > {
    try {
      const startTime = Date.now();
      const stmt = this.db.prepare(sql);

      // Check if this is a write operation
      const trimmedSql = sql.trim().toLowerCase();
      const isWriteOp = trimmedSql.startsWith("insert") ||
        trimmedSql.startsWith("update") ||
        trimmedSql.startsWith("delete") ||
        trimmedSql.startsWith("replace") ||
        trimmedSql.startsWith("create") ||
        trimmedSql.startsWith("drop") ||
        trimmedSql.startsWith("alter");

      let rows: Record<string, unknown>[];
      let changes: StatementResultingChanges;

      const sqlStripped = sql.replace(/'([^']|'')*'/g, "''");
      const hasReturning = /\breturning\b/i.test(sqlStripped);

      // Run query based on operation type
      if (isWriteOp && !hasReturning) {
        rows = [];
        changes = stmt.run(...params);
      } else if (isWriteOp && hasReturning) {
        rows = stmt.all(...params) as Record<string, unknown>[];
        changes = { changes: rows.length, lastInsertRowid: BigInt(0) };
      } else {
        rows = stmt.all(...params) as Record<string, unknown>[];
        changes = { changes: 0, lastInsertRowid: 0 };
      }

      const results = mode === "raw"
        ? {
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          rows: rows.map((row) => Object.values(row)),
        } as const
        : rows.map((r) => ({ ...r }));

      return [{
        results,
        success: true,
        meta: {
          ...D1DatabaseLocal.BASE_META,
          duration: Date.now() - startTime,
          changes: changes.changes,
          last_row_id: changes.lastInsertRowid,
          changed_db: changes.changes > 0,
          size_after: 0,
          rows_read: rows.length,
          rows_written: changes.changes,
        },
      }] as unknown as Mode extends "raw" ? Array<
          D1Response & { results: { columns: string[]; rows: T[] } }
        >
        : D1Result<T>[];
    } catch (error) {
      throw new Error(`SQLite error: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}
