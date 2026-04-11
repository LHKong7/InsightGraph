import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";

export interface PrecheckResult {
  ok: boolean;
  node: { available: boolean; version: string };
  docker: { available: boolean; version: string };
  dockerCompose: { available: boolean; version: string };
  binary: { available: boolean; path: string };
  missing: string[];
}

async function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5_000 }, (err, stdout) => {
      resolve(err ? "" : stdout.trim());
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether required dependencies are available.
 *
 * @param needNode    Set true when using "source" mode.
 * @param needDocker  Set true when startDocker is enabled.
 * @param binaryPath  Path to the pre-packaged server binary (binary mode).
 */
export async function checkEnvironment(opts: {
  needNode?: boolean;
  needDocker?: boolean;
  binaryPath?: string;
}): Promise<PrecheckResult> {
  const missing: string[] = [];

  // Node.js
  const nodeVersion = await run("node", ["--version"]);
  const nodeAvail = nodeVersion.startsWith("v");
  if (opts.needNode && !nodeAvail) missing.push("Node.js 22+ (https://nodejs.org)");

  // Docker
  const dockerVersion = await run("docker", ["--version"]);
  const dockerAvail = dockerVersion.length > 0;
  if (opts.needDocker && !dockerAvail)
    missing.push("Docker (https://docs.docker.com/get-docker/)");

  // Docker Compose
  const composeVersion = await run("docker", ["compose", "version"]);
  const composeAvail = composeVersion.length > 0;
  if (opts.needDocker && !composeAvail) missing.push("Docker Compose v2");

  // Binary
  const binAvail = opts.binaryPath ? await fileExists(opts.binaryPath) : false;

  return {
    ok: missing.length === 0,
    node: { available: nodeAvail, version: nodeVersion },
    docker: { available: dockerAvail, version: dockerVersion },
    dockerCompose: { available: composeAvail, version: composeVersion },
    binary: { available: binAvail, path: opts.binaryPath ?? "" },
    missing,
  };
}
