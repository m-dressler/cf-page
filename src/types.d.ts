declare global {
  // deno-lint-ignore no-explicit-any
  type PartialBy<T extends Record<any, any>, U extends keyof T> =
    & Omit<T, U>
    & {
      [K in U]?: T[K];
    };
}

export {};
