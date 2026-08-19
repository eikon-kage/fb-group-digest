/**
 * The archive of posts already reported.
 *
 * `seen.json` remembers *that* a post was reported, as bare fingerprints; this
 * file remembers the post itself, analysis included, so a later report can show
 * it again without collecting or classifying it a second time. Reading yesterday
 * and today in one page is the point — a run that surfaces four new posts is
 * hard to read on its own.
 *
 * Entries are pruned past a retention window so the file cannot grow forever,
 * the same way `seen.json` is.
 */

import { readJson, writeJson } from "./io.js";
import { seenKeys } from "./seen.js";

/** Kept longer than the default report window, so `--history 14` still works. */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * @param {string} path
 * @returns {Promise<Array<object>>} posts, each carrying `reportedAt`
 */
export async function loadHistory(path) {
    const data = await readJson(path, []);
    return Array.isArray(data) ? data.filter((post) => post && typeof post === "object") : [];
}

/**
 * Every key a post can be recognised by, ignoring the ones a malformed entry
 * cannot supply.
 *
 * @param {object} post
 * @returns {string[]}
 */
function keysOf(post) {
    return seenKeys(post).filter((key) => typeof key === "string" && key !== "");
}

/**
 * Add this run's posts to the archive, newest first, and drop what has aged out.
 *
 * A post already in the archive keeps its original `reportedAt` — that date is
 * what "from a previous run" means, and re-reporting must not reset it.
 *
 * @param {Array<object>} history
 * @param {Array<object>} posts
 * @param {{ retentionDays?: number, now?: Date }} [options]
 * @returns {Array<object>}
 */
export function addToHistory(history, posts, options = {}) {
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

    const known = new Set();
    const out = [];

    const push = (post, reportedAt) => {
        const keys = keysOf(post);
        if (keys.some((key) => known.has(key))) return;
        for (const key of keys) known.add(key);
        out.push({ ...post, reportedAt });
    };

    // This run first, so its entries win the de-duplication against older
    // copies of the same post — a post whose text grew since is worth updating.
    for (const post of posts) push(post, now.toISOString());

    for (const post of history) {
        const at = Date.parse(post.reportedAt ?? "");
        // An entry with no readable stamp is dropped: it cannot be placed in a
        // window, so keeping it would only ever be noise.
        if (Number.isNaN(at) || at < cutoff) continue;
        push(post, post.reportedAt);
    }

    return out;
}

/**
 * The archived posts a report should show alongside this run's, tagged so the
 * renderer can label them.
 *
 * @param {Array<object>} history
 * @param {Array<object>} current Posts this run is already reporting.
 * @param {{ days?: number, now?: Date }} [options]
 * @returns {Array<object>}
 */
export function recentHistory(history, current, options = {}) {
    const days = options.days ?? 0;
    if (days <= 0) return [];

    const now = options.now ?? new Date();
    const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;

    const skip = new Set();
    for (const post of current) {
        for (const key of keysOf(post)) skip.add(key);
    }

    const out = [];
    for (const post of history) {
        const at = Date.parse(post.reportedAt ?? "");
        if (Number.isNaN(at) || at < cutoff) continue;
        if (keysOf(post).some((key) => skip.has(key))) continue;
        for (const key of keysOf(post)) skip.add(key);
        out.push({ ...post, previous: true });
    }

    return out;
}

/**
 * @param {string} path
 * @param {Array<object>} history
 */
export async function saveHistory(path, history) {
    await writeJson(path, history);
}
