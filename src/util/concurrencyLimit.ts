/** A pessimistic assumption on the memory required to build each file (considering e.g. esbuild) */
const ESTIMATED_MB_PER_FILE = 25;
/** Allows concurrency limiting based on logical CPU count. Currently oversubscribing for I/O */
const CPU_MULTIPLIER = 2;

/** Returns envvar `CF_PAGE_CONCURRENCY` or estimates max parallel file builds possible without overstraining the running machine */
export const getBuildConcurrencyLimit = () => {
  const envConcurrencyLimit = Number(Deno.env.get("CF_PAGE_CONCURRENCY"));
  if (
    envConcurrencyLimit && !isNaN(envConcurrencyLimit) &&
    envConcurrencyLimit >= 1
  ) {
    return Math.floor(envConcurrencyLimit);
  }

  /** We limit to amount of threads available but add some additional limit to allow async logic to yield to different thread */
  const cpuLimit = navigator.hardwareConcurrency * CPU_MULTIPLIER;
  const memoryLimit = Math.floor(
    Deno.systemMemoryInfo().available /
      (ESTIMATED_MB_PER_FILE * 1e6),
  );

  const leastLimit = Math.min(cpuLimit, memoryLimit);
  return Math.max(1, leastLimit);
};
