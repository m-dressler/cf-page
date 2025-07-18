declare global {
  type ENV = {
    APP_SECRET: string;
    USERNAME: string;
    PASSWORD: string;
    // See deno.jsonc for details on enabling bindings
    // DB: D1Database;
  };
}

export {};
