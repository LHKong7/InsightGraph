/**
 * Simple concurrency limiter (replaces p-limit to avoid ESM import issues).
 */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          const next = queue.shift();
          if (next) next();
        });
      };

      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
