/** CSV export (RFC 4180), UTF-8 with BOM so Excel reads Vietnamese correctly. */

const COLUMNS = [
    ["group", (post) => post.groupName ?? ""],
    ["category", (post) => post.analysis?.category ?? ""],
    ["urgency", (post) => post.analysis?.urgency ?? ""],
    ["score", (post) => String(post.score ?? "")],
    ["rules", (post) => (post.rules ?? []).join(" | ")],
    ["summary", (post) => post.analysis?.summary ?? ""],
    ["entities", (post) => (post.analysis?.entities ?? []).join(" | ")],
    ["text", (post) => post.text ?? ""],
    ["permalink", (post) => post.permalink ?? ""],
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
 * @param {Array<object>} posts
 * @returns {string}
 */
export function toCsv(posts) {
    const rows = [COLUMNS.map(([name]) => name).join(",")];

    for (const post of posts) {
        rows.push(COLUMNS.map(([, read]) => escapeField(read(post))).join(","));
    }

    // Leading BOM: without it Excel on Windows mis-decodes UTF-8 Vietnamese.
    return `﻿${rows.join("\r\n")}\r\n`;
}
