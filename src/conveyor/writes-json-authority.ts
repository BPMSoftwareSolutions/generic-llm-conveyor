import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

/**
 * The conveyor's only persistence capability.
 *
 * TypeScript targets cannot cross this port. Executable embodiment belongs to
 * the declared projector process.
 */
export async function writesJsonAuthority(
  path: string,
  authority: unknown
): Promise<void> {
  if (extname(path).toLowerCase() !== ".json") {
    throw new Error(`Conveyor persistence rejects non-JSON target: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(authority, null, 2)}\n`);
}
