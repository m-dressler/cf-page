/** An error thrown when the build is aborted */
export class AbortError extends Error {
  constructor() {
    super("Build aborted");
  }
}

/** Throws an {@link AbortError} if the abort controller is aborted */
export const throwIfAborted = (abortController?: AbortController) => {
  if (abortController?.signal.aborted) throw new AbortError();
};
