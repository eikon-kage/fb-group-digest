/**
 * Post timestamp parsing.
 *
 * This is best-effort, and usually yields nothing for a group post. Facebook
 * scrambles the post's own timestamp in the DOM — one element per character,
 * shuffled, reassembled visually with CSS — so `postedAt` is normally null.
 * A readable label does turn up in two cases, and both are handled here:
 * an absolute date on an older post ("Friday 31 July 2026 at 03:38"), and a
 * relative one that escaped scrambling ("15h", "3 ngày", "2w").
 *
 * Relative labels are coarse: "15h" could be anywhere in a one-hour band, and
 * "2w" rounds hard. Treat the result as an approximation — `collectedAt` is
 * the reliable timestamp.
 *
 * `new Date()` cannot read either form, so the fields are pulled out by hand.
 * A label that does not parse yields null, and the caller keeps the post
 * rather than dropping it.
 */

/** English month names, full and abbreviated, as they appear in aria-labels. */
const MONTH_NAMES = new Map([
    ["january", 0],
    ["february", 1],
    ["march", 2],
    ["april", 3],
    ["may", 4],
    ["june", 5],
    ["july", 6],
    ["august", 7],
    ["september", 8],
    ["october", 9],
    ["november", 10],
    ["december", 11],
    ["jan", 0],
    ["feb", 1],
    ["mar", 2],
    ["apr", 3],
    ["jun", 5],
    ["jul", 6],
    ["aug", 7],
    ["sep", 8],
    ["sept", 8],
    ["oct", 9],
    ["nov", 10],
    ["dec", 11],
]);

/** "31 tháng 7, 2026" — Vietnamese writes the month as a number. */
const VI_PATTERN = /(\d{1,2})\s+tháng\s*(\d{1,2}),?\s+(\d{4})/;
/** "31 July 2026" — day first, the form Facebook uses in en-GB. */
const DAY_FIRST_PATTERN = /(\d{1,2})\s+([a-z]+),?\s+(\d{4})/;
/** "July 31, 2026" — month first, the form Facebook uses in en-US. */
const MONTH_FIRST_PATTERN = /([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/;
/** "31 July at 03:38" — same-year posts lose the year. */
const NO_YEAR_PATTERN = /(\d{1,2})\s+([a-z]+)\b/;
/** "at 03:38" / "lúc 03:38" — optional; a bare date is treated as midnight. */
const TIME_PATTERN = /(\d{1,2}):(\d{2})/;

/** Milliseconds per unit, keyed by every spelling Facebook uses. */
const RELATIVE_UNITS = new Map([
    ["m", 60_000],
    ["min", 60_000],
    ["mins", 60_000],
    ["minute", 60_000],
    ["minutes", 60_000],
    ["phút", 60_000],
    ["h", 3_600_000],
    ["hr", 3_600_000],
    ["hrs", 3_600_000],
    ["hour", 3_600_000],
    ["hours", 3_600_000],
    ["giờ", 3_600_000],
    ["d", 86_400_000],
    ["day", 86_400_000],
    ["days", 86_400_000],
    ["ngày", 86_400_000],
    ["w", 604_800_000],
    ["wk", 604_800_000],
    ["week", 604_800_000],
    ["weeks", 604_800_000],
    ["tuần", 604_800_000],
]);

/** "15h", "3 ngày", "2 weeks" — the whole label must be just that. */
const RELATIVE_PATTERN = /^(\d{1,3})\s*([a-zà-ỹ]+)$/;

/** "Just now" / "Vừa xong" — treat as this instant. */
const JUST_NOW = /^(just now|vừa xong|a few seconds ago)$/;

/**
 * Parse a Facebook timestamp label into a Date.
 *
 * Handles both the relative label a post carries ("15h") and the absolute one
 * that older posts and comment anchors carry ("31 July 2026 at 03:38").
 *
 * @param {string | null | undefined} label
 * @param {Date} [now] Reference point for relative labels.
 * @returns {Date | null} null when the label is missing or unrecognised.
 */
export function parsePostedAt(label, now = new Date()) {
    if (typeof label !== "string") return null;

    // Only the case is folded — diacritics are load-bearing here ("tháng").
    const text = label.toLowerCase().trim();

    if (JUST_NOW.test(text)) return new Date(now.getTime());

    const relative = text.match(RELATIVE_PATTERN);
    if (relative) {
        const unit = RELATIVE_UNITS.get(relative[2]);
        if (unit === undefined) return null;
        return new Date(now.getTime() - Number(relative[1]) * unit);
    }

    let day;
    let month;
    let year;

    const vi = text.match(VI_PATTERN);
    if (vi) {
        day = Number(vi[1]);
        month = Number(vi[2]) - 1;
        year = Number(vi[3]);
    }

    if (month === undefined) {
        const dayFirst = text.match(DAY_FIRST_PATTERN);
        if (dayFirst && MONTH_NAMES.has(dayFirst[2])) {
            day = Number(dayFirst[1]);
            month = MONTH_NAMES.get(dayFirst[2]);
            year = Number(dayFirst[3]);
        }
    }

    if (month === undefined) {
        const monthFirst = text.match(MONTH_FIRST_PATTERN);
        if (monthFirst && MONTH_NAMES.has(monthFirst[1])) {
            month = MONTH_NAMES.get(monthFirst[1]);
            day = Number(monthFirst[2]);
            year = Number(monthFirst[3]);
        }
    }

    if (month === undefined) {
        // "31 July at 03:38" — Facebook drops the year within the same year.
        const noYear = text.match(NO_YEAR_PATTERN);
        if (noYear && MONTH_NAMES.has(noYear[2])) {
            day = Number(noYear[1]);
            month = MONTH_NAMES.get(noYear[2]);
            year = now.getFullYear();
        }
    }

    if (month === undefined || month < 0 || month > 11) return null;
    if (!(day >= 1 && day <= 31)) return null;

    const time = text.match(TIME_PATTERN);
    const hour = time ? Number(time[1]) : 0;
    const minute = time ? Number(time[2]) : 0;
    if (hour > 23 || minute > 59) return null;

    const date = new Date(year, month, day, hour, minute);
    // Rejects overflow like 31 February, which the Date constructor would
    // silently roll forward into March.
    if (date.getMonth() !== month || date.getDate() !== day) return null;

    return date;
}
