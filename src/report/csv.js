/** CSV export (RFC 4180), UTF-8 with BOM so Excel reads Vietnamese correctly. */

/** Columns of the final report, after filtering and Claude analysis. */
const REPORT_COLUMNS = [
    ["group", (post) => post.groupName ?? ""],
    ["category", (post) => post.analysis?.category ?? ""],
    ["urgency", (post) => post.analysis?.urgency ?? ""],
    ["score", (post) => String(post.score ?? "")],
    ["rules", (post) => (post.rules ?? []).join(" | ")],
    ["summary", (post) => post.analysis?.summary ?? ""],
    ["entities", (post) => (post.analysis?.entities ?? []).join(" | ")],
    ["text", (post) => post.text ?? ""],
    ["permalink", (post) => post.permalink ?? ""],
    ["author_name", (post) => post.authorName ?? ""],
    ["author_url", (post) => post.authorUrl ?? ""],
    ["author_id", (post) => post.authorId ?? ""],
    ["collected_at", (post) => post.collectedAt ?? ""],
];

/**
 * Columns of the raw collect output: everything scrape.js produces, before any
 * filtering. No analysis fields, and no poster identity — same scope as the
 * JSON dump next to it.
 */
const POST_COLUMNS = [
    ["id", (post) => post.id ?? ""],
    ["group", (post) => post.groupName ?? ""],
    ["group_id", (post) => post.groupId ?? ""],
    ["group_url", (post) => post.groupUrl ?? ""],
    ["posted_at", (post) => post.postedAt ?? ""],
    ["time_label", (post) => post.timeLabel ?? ""],
    ["text", (post) => post.text ?? ""],
    ["permalink", (post) => post.permalink ?? ""],
    ["author_name", (post) => post.authorName ?? ""],
    ["author_url", (post) => post.authorUrl ?? ""],
    ["author_id", (post) => post.authorId ?? ""],
    ["collected_at", (post) => post.collectedAt ?? ""],
];

/**
 * Quote a single field. Fields containing a comma, quote, or newline are
 * wrapped in quotes with inner quotes doubled.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeField(value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
}

/**
 * @param {Array<[string, (post: object) => string]>} columns
 * @param {Array<object>} posts
 * @returns {string}
 */
function build(columns, posts) {
    const rows = [columns.map(([name]) => name).join(",")];

    for (const post of posts) {
        rows.push(columns.map(([, read]) => escapeField(read(post))).join(","));
    }

    // Leading BOM: without it Excel on Windows mis-decodes UTF-8 Vietnamese.
    return `﻿${rows.join("\r\n")}\r\n`;
}

/**
 * Report CSV — filtered posts with their score and Claude analysis.
 *
 * @param {Array<object>} posts
 * @returns {string}
 */
export function toCsv(posts) {
    return build(REPORT_COLUMNS, posts);
}

/**
 * Collect CSV — every post read from the feeds, unfiltered.
 *
 * @param {Array<object>} posts
 * @returns {string}
 */
export function toPostsCsv(posts) {
    return build(POST_COLUMNS, posts);
}
