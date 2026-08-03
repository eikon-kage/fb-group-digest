/**
 * Cross-run deduplication.
 *
 * A post that stays near the top of a group's feed will be collected again on
 * tomorrow's run. The seen index keeps its fingerprint so it is reported once,
 * and prunes entries past a retention window so the file cannot grow forever.
 */

import { readJson, writeJson } from "./io.js";

const DEFAULT_RETENTION_DAYS = 30;

/**
 * @param {string} path
 * @returns {Promise<Record<string, string>>} fingerprint -> ISO timestamp
 */
export async function loadSeen(path) {
    const data = await readJson(path, {});
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

/**
 * Every key a post can be recognised by across runs.
 *
 * The fingerprint alone is not enough: clicking "See more" lengthens a post's
 * text, which changes its fingerprint, so the same post can arrive under two
 * ids on different runs. The permalink's numeric id does not move, and is used
 * whenever Facebook exposed one.
 *
 * @param {{ id: string, permalink?: string | null }} post
 * @returns {string[]}
 */
export function seenKeys(post) {
    const keys = [post.id];
    const match = post.permalink?.match(/\/(?:posts|permalink)\/(\d+)/);
    if (match) keys.push(`p:${match[1]}`);
    return keys;
}

/**
 * @param {Record<string, string>} seen
 * @param {{ id: string, permalink?: string | null }} post
 * @returns {boolean}
 */
export function isSeen(seen, post) {
    return seenKeys(post).some((key) => Object.hasOwn(seen, key));
}

/**
 * Split posts into ones not reported before and ones already known.
 *
 * @param {Array<{ id: string }>} posts
 * @param {Record<string, string>} seen
 * @returns {{ fresh: Array<object>, duplicates: Array<object> }}
 */
export function partitionBySeen(posts, seen) {
    const fresh = [];
    const duplicates = [];

    // A single collection pass can surface the same post twice (Facebook
    // re-renders while scrolling), so track within-batch keys as well.
    const batch = new Set();

    for (const post of posts) {
        const keys = seenKeys(post);
        if (isSeen(seen, post) || keys.some((key) => batch.has(key))) {
            duplicates.push(post);
            continue;
        }
        for (const key of keys) batch.add(key);
        fresh.push(post);
    }

    return { fresh, duplicates };
}

/**
 * Record posts as seen and drop entries older than the retention window.
 *
 * @param {string} path
 * @param {Record<string, string>} seen
 * @param {Array<{ id: string }>} posts
 * @param {{ retentionDays?: number, now?: Date }} [options]
 */
export async function commitSeen(path, seen, posts, options = {}) {
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

    const next = {};
    for (const [id, stamp] of Object.entries(seen)) {
        const at = Date.parse(stamp);
        // Keep unparseable entries rather than silently dropping history.
        if (Number.isNaN(at) || at >= cutoff) next[id] = stamp;
    }
    for (const post of posts) {
        for (const key of seenKeys(post)) next[key] = now.toISOString();
    }

    await writeJson(path, next);
    return next;
}
