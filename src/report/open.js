import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

/**
 * Open a file in the default browser, without waiting for the browser.
 *
 * The child is detached and unref'd so the CLI exits as soon as the command
 * is handed off; a browser that is already open would otherwise keep this
 * process alive until its window closed.
 *
 * @param {string} path
 */
export function openInBrowser(path) {
    const target = resolve(path);
    const [cmd, args] =
        process.platform === "darwin"
            ? ["open", [target]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", "", target]]
              : ["xdg-open", [target]];

    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    // Failing to open is not worth failing the run over: the report is on
    // disk either way, and its path has already been logged.
    child.on("error", () => {});
    child.unref();
}

/**
 * The most recent `report-<date>.html` in a directory, or null if none.
 * Dates are ISO, so the names sort by date.
 *
 * @param {string} dir
 * @returns {Promise<string | null>}
 */
export async function latestReport(dir = "out") {
    const names = await readdir(dir).catch(() => []);
    const reports = names.filter((n) => /^report-\d{4}-\d{2}-\d{2}\.html$/.test(n)).sort();
    return reports.length > 0 ? join(dir, reports.at(-1)) : null;
}
