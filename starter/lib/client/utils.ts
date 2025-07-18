export const $ = <T extends Element>(query: string) =>
  document.querySelector<T>(query);
