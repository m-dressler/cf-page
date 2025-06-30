/** An error thrown when the build is aborted */
export class AbortError extends Error {
  constructor() {
    super("Build aborted");
  }
}
