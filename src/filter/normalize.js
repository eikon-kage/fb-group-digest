/**
 * Vietnamese-aware text normalization.
 *
 * Vietnamese users routinely type without diacritics ("can mua laptop" for
 * "cần mua laptop"), so every comparison in the keyword engine runs against a
 * folded form: lowercased, diacritics stripped, đ/Đ mapped to d, and runs of
 * whitespace collapsed.
 */

/** Combining diacritical marks, left behind after NFD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Characters that Unicode NFD does not decompose but Vietnamese needs folded. */
const EXTRA_FOLDS = new Map([
    ["đ", "d"], // đ
    ["Đ", "d"], // Đ
]);

/**
 * Fold text to a diacritic-free, lowercase, single-spaced form.
 *
 * @param {string} input
 * @returns {string}
 */
export function fold(input) {
    if (typeof input !== "string" || input.length === 0) return "";

    let out = "";
    for (const char of input) {
        out += EXTRA_FOLDS.get(char) ?? char;
    }

    return out
        .normalize("NFD")
        .replace(COMBINING_MARKS, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Collapse runs of horizontal whitespace and excess blank lines, leaving
 * diacritics and case intact. Used for the copy that ends up in the report.
 *
 * @param {string} input
 * @returns {string}
 */
export function tidy(input) {
    if (typeof input !== "string") return "";
    return input
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * @param {string} char Empty string counts as a boundary.
 * @returns {boolean}
 */
function isWordChar(char) {
    return char !== "" && /[a-z0-9]/.test(char);
}

/**
 * Word-boundary-aware containment check on folded text.
 *
 * A plain `includes` would match "an" inside "banh"; this requires the needle
 * to sit at a non-alphanumeric boundary on both sides. Multi-word needles work
 * because the folded form is single-spaced.
 *
 * @param {string} foldedHaystack Already passed through `fold`.
 * @param {string} rawNeedle Folded internally, so callers may pass raw input.
 * @returns {boolean}
 */
export function containsTerm(foldedHaystack, rawNeedle) {
    const needle = fold(rawNeedle);
    if (needle === "" || foldedHaystack === "") return false;

    let from = 0;
    while (from <= foldedHaystack.length - needle.length) {
        const at = foldedHaystack.indexOf(needle, from);
        if (at === -1) return false;

        const before = at === 0 ? "" : foldedHaystack[at - 1];
        const afterIndex = at + needle.length;
        const after = afterIndex >= foldedHaystack.length ? "" : foldedHaystack[afterIndex];

        if (!isWordChar(before) && !isWordChar(after)) return true;
        from = at + 1;
    }
    return false;
}

/**
 * Stable fingerprint for deduplicating posts across runs.
 *
 * Facebook re-renders the same post with a different DOM id on every load, so
 * the id is derived from the content itself rather than from markup.
 *
 * @param {{ groupId?: string, text: string }} post
 * @returns {string}
 */
export function fingerprint(post) {
    const basis = `${post.groupId ?? ""}::${fold(post.text).slice(0, 400)}`;
    // FNV-1a, 32-bit. Enough to separate posts within one account's feed.
    let hash = 0x811c9dc5;
    for (let i = 0; i < basis.length; i++) {
        hash ^= basis.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
