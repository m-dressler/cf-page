export const $ = <
  K extends HTMLElementTagNameMap[keyof HTMLElementTagNameMap] | Element,
>(
  query: string,
) => document.querySelector(query) as K;
