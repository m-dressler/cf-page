import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { D1DatabaseLocal } from "./d1-local.ts";

const TABLES = {
  test: {
    columns: ["id INTEGER PRIMARY KEY", "name TEXT"],
    rows: [[1, "John Doe"], [2, "Jane Smith"]],
  },
  users: {
    columns: [
      "id INTEGER PRIMARY KEY",
      "name TEXT NOT NULL",
      "email TEXT UNIQUE",
    ],
    rows: [
      ["John Doe", "john@example.com"],
      ["Jane Smith", "jane@example.com"],
    ],
  },
  posts: {
    columns: [
      "id INTEGER PRIMARY KEY",
      "user_id INTEGER",
      "title TEXT",
      "content TEXT",
      "FOREIGN KEY(user_id) REFERENCES users(id)",
    ],
    rows: [
      [1, "First Post", "This is the first post"],
      [2, "Second Post", "This is the second post"],
    ],
  },
} as const;

/** Creates a test database in memory */
const createTestDb = (
  tables: Partial<Record<keyof typeof TABLES, "empty" | "dummy">> = {},
): D1Database => {
  const db = new D1DatabaseLocal(":memory:");
  for (
    const [table, creation] of Object.entries(tables)
  ) {
    const { columns, rows } = TABLES[table as keyof typeof TABLES];
    db.query(`CREATE TABLE ${table} (${columns.join(", ")})`);
    if (creation === "dummy") {
      const columnNames = columns
        .filter((col) =>
          !col.includes("FOREIGN KEY") && !col.includes("PRIMARY KEY")
        )
        .map((col) => col.split(" ")[0]);
      const rowPlaceholder = `(${columnNames.map(() => "?").join(", ")})`;
      db.query(
        `INSERT INTO ${table} (${columnNames.join(", ")}) VALUES ${
          Array(rows.length).fill(rowPlaceholder).join(", ")
        }`,
        rows.flat(),
      );
    }
  }
  return db;
};

/** Asserts that a {@link D1Result} matches the expected data with all unspecified properties in {@link expected}.meta defaulting to false/0 */
const assertD1Result = (
  actual: unknown,
  expected: { results: unknown[]; meta: Partial<D1Result["meta"]> },
  msg?: string,
) => {
  // Basic asserts
  assert(typeof actual === "object" && actual, "Is a valid D1Result");
  assert(
    "meta" in actual && typeof actual.meta === "object" && actual.meta,
    "Has the `meta` property",
  );

  // Assert dynamic values
  assert(
    "duration" in actual.meta && typeof actual.meta.duration === "number" &&
      actual.meta.duration >= 0,
    "Has a valid meta.duration",
  );
  assert(
    "last_row_id" in actual.meta &&
      typeof actual.meta.last_row_id === "number" &&
      actual.meta.last_row_id >= 0,
    "Has a valid meta.last_row_id",
  );

  // Assert main body
  assertEquals<unknown>(actual, {
    results: expected.results,
    success: true,
    meta: {
      /** Default meta headers */
      served_by: "sqlite",
      served_by_primary: true,
      served_by_region: "LOCAL",

      /** Expected with falsy defaults */
      changes: expected.meta.changes ?? 0,
      changed_db: expected.meta.changed_db ?? false,
      rows_read: expected.meta.rows_read ?? 0,
      rows_written: expected.meta.rows_written ?? 0,
      size_after: expected.meta.size_after ?? 0,

      /** Dynamic loosely validated above */
      duration: actual.meta.duration,
      last_row_id: actual.meta.last_row_id,
    },
  }, msg);
};

// Basic query method tests
Deno.test("D1DatabaseLocal - CREATE TABLE statement", async () => {
  const db = createTestDb();
  const result = await db
    .prepare("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)")
    .run();

  assertD1Result(result, { results: [], meta: {/** All falsy or zero */} });
});

Deno.test("D1DatabaseLocal - INSERT statement returns correct meta", async () => {
  const db = createTestDb();
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

  const result = await db
    .prepare("INSERT INTO users (name) VALUES (?)")
    .bind("John")
    .run();

  assertD1Result(result, {
    results: [],
    meta: { changes: 1, changed_db: true, last_row_id: 1, rows_written: 1 },
  });
});

Deno.test("D1DatabaseLocal - SELECT statement returns results", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db
    .prepare("SELECT * FROM users ORDER BY id")
    .all();

  assertD1Result(result, {
    results: [
      {
        id: 1,
        name: "John Doe",
        email: "john@example.com",
      },
      {
        id: 2,
        name: "Jane Smith",
        email: "jane@example.com",
      },
    ],
    meta: { rows_read: 2 },
  });
});

Deno.test("D1DatabaseLocal - SELECT with parameters", async () => {
  const db = createTestDb({ users: "dummy" });

  const result = await db
    .prepare("SELECT * FROM users WHERE name = ?")
    .bind("John Doe")
    .all();

  assertD1Result(result, {
    results: [
      {
        id: 1,
        name: "John Doe",
        email: "john@example.com",
      },
    ],
    meta: { rows_read: 1 },
  });
});

Deno.test("D1DatabaseLocal - UPDATE statement", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db
    .prepare("UPDATE users SET name = ? WHERE id = ?")
    .bind("John Updated", 1)
    .run();

  assertD1Result(result, {
    results: [],
    meta: { changes: 1, changed_db: true, rows_written: 1 },
  });

  // Verify update worked
  const verifyResult = await db
    .prepare("SELECT name FROM users WHERE id = 1")
    .first<{ name: string }>();
  assertEquals(verifyResult?.name, "John Updated");
});

Deno.test("D1DatabaseLocal - DELETE statement", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  // First delete posts to avoid foreign key constraint
  await db.prepare("DELETE FROM posts WHERE user_id = ?").bind(1).run();

  const result = await db
    .prepare("DELETE FROM users WHERE id = ?")
    .bind(1)
    .run();

  assertD1Result(result, {
    results: [],
    meta: { changes: 1, changed_db: true, rows_written: 1 },
  });

  // Verify deletion worked
  const verifyResult = await db
    .prepare("SELECT COUNT(*) as count FROM users")
    .first<{ count: number }>();
  assertEquals(verifyResult?.count, 1);
});

// Raw mode tests
Deno.test("D1DatabaseLocal - raw mode SELECT", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db
    .prepare("SELECT name, email FROM users ORDER BY id")
    .raw();

  assertEquals(result, [
    ["John Doe", "john@example.com"],
    ["Jane Smith", "jane@example.com"],
  ]);
});

Deno.test("D1DatabaseLocal - raw mode INSERT", async () => {
  const db = createTestDb();
  await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

  const result = await db
    .prepare("INSERT INTO test (value) VALUES (?)")
    .bind("test value")
    .run();

  assertD1Result(result, {
    results: [],
    meta: { changes: 1, changed_db: true, last_row_id: 1, rows_written: 1 },
  });
});

Deno.test("D1DatabaseLocal - raw mode with empty result set", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db.prepare("SELECT * FROM users WHERE id = 999").raw();

  assertEquals(result, []);
});

// Prepared statement tests
Deno.test("D1PreparedStatement - bind and run", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
  const boundStmt = stmt.bind("Test User", "test@example.com");
  const result = await boundStmt.run();

  assertD1Result(result, {
    results: [],
    meta: { changes: 1, changed_db: true, last_row_id: 3, rows_written: 1 },
  });
});

Deno.test("D1PreparedStatement - bind and all", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("SELECT * FROM users WHERE name LIKE ?");
  const boundStmt = stmt.bind("%John%");
  const result = await boundStmt.all();

  assertD1Result(result, {
    results: [
      {
        id: 1,
        name: "John Doe",
        email: "john@example.com",
      },
    ],
    meta: { changed_db: false, rows_read: 1 },
  });
});

Deno.test("D1PreparedStatement - first method", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("SELECT * FROM users ORDER BY id");
  const result = await stmt.first();

  assertEquals(result, { id: 1, name: "John Doe", email: "john@example.com" });
});

Deno.test("D1PreparedStatement - first with column name", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("SELECT name FROM users WHERE id = ?");
  const boundStmt = stmt.bind(1);
  const result = await boundStmt.first<string>("name");

  assertEquals(result, "John Doe");
});

Deno.test("D1PreparedStatement - first returns null for no results", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("SELECT * FROM users WHERE id = 999");
  const result = await stmt.first();

  assertEquals(result, null);
});

Deno.test("D1PreparedStatement - raw method", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("SELECT name, email FROM users ORDER BY id");
  const result = await stmt.raw();

  assertEquals(result, [
    ["John Doe", "john@example.com"],
    ["Jane Smith", "jane@example.com"],
  ]);
});

Deno.test("D1PreparedStatement - raw method with columnNames option", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare("SELECT name, email FROM users ORDER BY id LIMIT 1");
  const result = await stmt.raw({ columnNames: true });

  assertEquals(result, [
    ["name", "email"],
    ["John Doe", "john@example.com"],
  ]);
});

// Bind method parameter validation tests
Deno.test("D1PreparedStatement - bind validates parameters", async () => {
  const db = createTestDb();
  await db.exec("CREATE TABLE test (value TEXT)");

  // Valid parameters - test by actually running the statements
  const stmt = db.prepare("INSERT INTO test (value) VALUES (?)");

  await stmt.bind("string").run();
  await stmt.bind(42).run();
  await stmt.bind(null).run();

  const count = await db
    .prepare("SELECT COUNT(*) as count FROM test")
    .first<{ count: number }>();
  assertEquals(count, { count: 3 });
});

Deno.test("D1PreparedStatement - bind rejects invalid parameters", () => {
  const db = createTestDb();
  const stmt = db.prepare("SELECT ?");

  assertThrows(
    () => stmt.bind({}),
    Error,
    "D1_TYPE_ERROR: Type 'object' not supported",
  );

  assertThrows(
    () => stmt.bind(Symbol("test")),
    Error,
    "Cannot convert a Symbol value to a string",
  );

  assertThrows(
    () => stmt.bind(() => {}),
    Error,
    "D1_TYPE_ERROR: Type 'function' not supported",
  );
});

// Batch operations
Deno.test("D1DatabaseLocal - batch without parameters", async () => {
  const db = createTestDb();
  await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

  const stmt1 = db.prepare("INSERT INTO test (value) VALUES ('batch1')");
  const stmt2 = db.prepare("INSERT INTO test (value) VALUES ('batch2')");

  const result = await db.batch([stmt1, stmt2]);
  assertEquals(result.length, 2);

  // Verify inserts worked
  const verifyResult = await db
    .prepare("SELECT COUNT(*) as count FROM test")
    .first<{ count: number }>();
  assertEquals(verifyResult, { count: 2 });
});

Deno.test("D1DatabaseLocal - batch with bound parameters throws error", async () => {
  const db = createTestDb();
  await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");

  const results = await db.batch([
    db.prepare("INSERT INTO test (value) VALUES (?)").bind("test"),
    db.prepare("INSERT INTO test (value) VALUES ('batch2')"),
  ]);

  assertEquals(results.length, 2);
  assertD1Result(results[0], {
    results: [],
    meta: { changed_db: true, changes: 1, rows_written: 1 },
  });
  assertD1Result(results[1], {
    results: [],
    meta: { changed_db: true, changes: 1, rows_written: 1 },
  });
});

// Exec method
Deno.test("D1DatabaseLocal - exec method", async () => {
  const db = createTestDb();

  const result = await db.exec(`
    CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT);
    INSERT INTO test (value) VALUES ('test1');
    INSERT INTO test (value) VALUES ('test2');
  `);

  assertEquals(typeof result.duration, "number");
  assertEquals(result, { count: 3, duration: result.duration });

  // Verify exec worked
  const verifyResult = await db
    .prepare("SELECT COUNT(*) as count FROM test")
    .first<{ count: number }>();
  assertEquals(verifyResult, { count: 2 });
});

// Error handling tests
Deno.test("D1DatabaseLocal - handles SQL syntax errors", async () => {
  const db = createTestDb();

  await assertRejects(
    () => db.exec("INVALID SQL STATEMENT"),
    Error,
    "SQLite error:",
  );
});

Deno.test("D1DatabaseLocal - handles constraint violations", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  await assertRejects(
    () =>
      db.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
        .bind("Test", "john@example.com")
        .run(),
    Error,
    "SQLite error:",
  );
});

// Unsupported method tests
Deno.test("D1DatabaseLocal - withSession throws error", () => {
  const db = createTestDb();

  assertThrows(
    () => db.withSession(),
    Error,
    "D1.withSession() is not yet supported",
  );
});

Deno.test("D1DatabaseLocal - dump throws error", async () => {
  const db = createTestDb();

  await assertRejects(
    () => db.dump(),
    Error,
    "`dump()` not implemented as deprecated",
  );
});

// Edge cases and complex scenarios
Deno.test("D1DatabaseLocal - multiple parameter types in single query", async () => {
  const db = createTestDb();
  await db.exec(
    "CREATE TABLE mixed (id INTEGER, text_val TEXT, null_val TEXT)",
  );

  const result = await db
    .prepare("INSERT INTO mixed (id, text_val, null_val) VALUES (?, ?, ?)")
    .bind(42, "hello", null)
    .run();

  assertD1Result(result, {
    results: [],
    meta: { changes: 1, changed_db: true, rows_written: 1 },
  });

  const selectResult = await db.prepare("SELECT * FROM mixed").first();
  assertEquals(selectResult, { id: 42, text_val: "hello", null_val: null });
});

Deno.test("D1DatabaseLocal - complex JOIN query", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db.prepare(`
    SELECT u.name, p.title 
    FROM users u 
    JOIN posts p ON u.id = p.user_id 
    ORDER BY u.id
  `).all();

  assertD1Result(result, {
    results: [
      { name: "John Doe", title: "First Post" },
      { name: "Jane Smith", title: "Second Post" },
    ],
    meta: { rows_read: 2 },
  });
});

Deno.test("D1DatabaseLocal - transaction-like operations", async () => {
  const db = createTestDb();
  await db.exec(`
    CREATE TABLE counter (value INTEGER);
    INSERT INTO counter (value) VALUES (0);
  `);

  // Multiple updates
  await db.prepare("UPDATE counter SET value = value + 1").run();
  await db.prepare("UPDATE counter SET value = value + 2").run();
  await db.prepare("UPDATE counter SET value = value + 3").run();

  const result = await db
    .prepare("SELECT value FROM counter")
    .first<{ value: number }>();
  assertEquals(result, { value: 6 });
});

Deno.test("D1DatabaseLocal - prepared statement reuse", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const stmt = db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE name LIKE ?",
  );

  // Use same statement multiple times with different parameters
  const result1 = await stmt.bind("%John%").all<{ count: number }>();
  assertD1Result(result1, { results: [{ count: 1 }], meta: { rows_read: 1 } });

  const result2 = await stmt.bind("%Smith%").all();
  assertD1Result(result2, { results: [{ count: 1 }], meta: { rows_read: 1 } });

  const result3 = await stmt.bind("%Nobody%").all();
  assertD1Result(result3, { results: [{ count: 0 }], meta: { rows_read: 1 } });
});

Deno.test("D1DatabaseLocal - handles empty parameter arrays", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db
    .prepare("SELECT COUNT(*) as count FROM users")
    .first<{ count: number }>();

  assertEquals(result, { count: 2 });
});

Deno.test("D1DatabaseLocal - handles queries with no parameters", async () => {
  const db = createTestDb({ users: "dummy", posts: "dummy" });

  const result = await db
    .prepare("SELECT COUNT(*) as count FROM users")
    .first<{ count: number }>();

  assertEquals(result, { count: 2 });
});
