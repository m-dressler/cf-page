import type { VFS } from "../build/gatherVFS.ts";

/** Logs performance metrics for all files in the VFS */
export const logPerformanceMetrics = (vfs: VFS): void => {
  const filesWithTiming = Array.from(vfs.build.values())
    .filter((file) => file.processingTime !== undefined)
    .sort((a, b) => (b.processingTime || 0) - (a.processingTime || 0));

  if (filesWithTiming.length === 0) {
    console.log("📊 No performance data available");
    return;
  }

  const totalTime = filesWithTiming.reduce(
    (sum, file) => sum + (file.processingTime || 0),
    0,
  );
  const averageTime = totalTime / filesWithTiming.length;

  console.log("\n📊 Build Performance Metrics:");
  console.log(`Total processing time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per file: ${averageTime.toFixed(2)}ms`);
  console.log(`Files processed: ${filesWithTiming.length}`);

  console.log("\n🐌 Slowest files:");
  filesWithTiming.slice(0, 10).forEach((file, index) => {
    console.log(
      `${index + 1}. ${file.outPath} - ${file.processingTime!.toFixed(2)}ms`,
    );
  });

  const byExtension = new Map<string, { count: number; totalTime: number }>();
  filesWithTiming.forEach((file) => {
    const ext = file.outExtension;
    const existing = byExtension.get(ext) || { count: 0, totalTime: 0 };
    byExtension.set(ext, {
      count: existing.count + 1,
      totalTime: existing.totalTime + (file.processingTime || 0),
    });
  });

  console.log("\n📁 Performance by file type:");
  Array.from(byExtension.entries())
    .sort(([, a], [, b]) => b.totalTime - a.totalTime)
    .forEach(([ext, stats]) => {
      const avgTime = stats.totalTime / stats.count;
      console.log(
        `${ext}: ${stats.count} files, ${
          stats.totalTime.toFixed(
            2,
          )
        }ms total, ${avgTime.toFixed(2)}ms avg`,
      );
    });
};
