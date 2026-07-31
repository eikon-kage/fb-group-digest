/** JSON file helpers used by every stage of the pipeline. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * @param {string} path
 * @param {unknown} fallback Returned when the file does not exist yet.
 * @returns {Promise<any>}
 */
export async function readJson(path, fallback = null) {
    try {
        return JSON.parse(await readFile(resolve(path), "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return fallback;
        throw error;
    }
}

/**
 * @param {string} path
 * @param {unknown} value
 */
export async function writeJson(path, value) {
    const resolved = resolve(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * @param {string} path
 * @param {string} contents
 */
export async function writeText(path, contents) {
    const resolved = resolve(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, contents, "utf8");
}
