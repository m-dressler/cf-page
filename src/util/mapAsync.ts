/**
 * Maps over an iterable with limited concurrency, preventing resource exhaustion
 * on low-spec machines. Processes items in batches of `limit` concurrent operations.
 *
 * @param iterable The items to process
 * @param fn The async function to apply to each item
 * @param limit Maximum concurrent operations
 */
export const mapConcurrent = async <T, R>(
  iterable: Iterable<T>,
  fn: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<R[]> => {
  if (limit < 1) throw new RangeError("limit must be >= 1");

  const items = Array.from(iterable);
  // Exit early as we don't need to custom-handle concurrency
  if (items.length <= limit) return Promise.all(items.map(fn));

  const results = new Array<R>(items.length);

  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));

  return results;
};
