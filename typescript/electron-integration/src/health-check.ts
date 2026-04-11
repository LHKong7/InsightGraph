import http from "node:http";

/**
 * Poll the backend health endpoint until it responds 200 or timeout.
 */
export function waitForBackend(
  url: string,
  timeout: number,
  interval: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;

    const check = () => {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }

      const req = http.get(url, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on("error", () => {
        setTimeout(check, interval);
      });

      req.setTimeout(2_000, () => {
        req.destroy();
        setTimeout(check, interval);
      });
    };

    check();
  });
}
