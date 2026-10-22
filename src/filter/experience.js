/**
 * Years-of-experience extraction from a job post.
 *
 * Recruiters write the requirement a dozen ways — "5+ năm kinh nghiệm",
 * "từ 5 yoe", "5y+", "tối thiểu 5 năm", "5–7 năm", "6+ years of" — and a bare
 * number next to "năm" is just as often something else ("sau 6 năm, công ty…",
 * "hợp đồng 2 năm"). So a number only counts when something around it says it
 * is experience: a "+", an experience word after it, a "từ/tối thiểu/≥" before
 * it, or a unit that only ever means experience (yoe, y+).
 *
 * A range counts by its lower end: "3–5 năm" asks for 3, and "4.5-5 năm" for
 * 4.5 — both are open to someone who does not yet have 5. That is why a number
 * right after a dash or "đến" is never read on its own.
 *
 * Every pattern runs on folded text (see `normalize.fold`): no diacritics,
 * lower case.
 */

/**
 * The number, not preceded by a digit, a decimal point, the start of a range
 * ("3-", "3 đến ") or "không cần " — "không cần 7–8 năm" is the opposite of a
 * requirement.
 */
const NUM = String.raw`(?<![\d.,]|\d\s*(?:-|–|~|den|to)\s*|khong can\s*)(\d{1,2}(?:[.,]\d)?)`;
const UNIT = String.raw`(?:nam|years?|yrs?)`;

const PATTERNS = [
    // "5+ năm", "5 + years", "5+yoe", "5+ exp"
    String.raw`${NUM}\s*\+\s*(?:${UNIT}|yoe|y\b|exp)`,
    // "5 năm+", "5 năm kinh nghiệm", "5 years of", "5 năm trở lên"
    String.raw`${NUM}\s*${UNIT}\s*(?:\+|kinh nghiem|knghiem|kn\b|exp|experience|of\b|in\b|with\b|thuc chien|lam viec|tro len)`,
    // "5yoe", "5 exp", "5y+", "5y kn"
    String.raw`${NUM}\s*(?:yoe|exp\b|y\s*\+|y\s*(?:kn|kinh nghiem|exp))`,
    // "từ 5 năm", "tối thiểu 5 years", "≥ 5 năm", "kinh nghiệm: 5 năm"
    String.raw`(?:\btu|toi thieu|it nhat|at least|\bover|\btren|\bhon|\bmin|>=|≥|>|kinh nghiem\s*:?|yeu cau\s*:?|\bkn\s*:?)\s*${NUM}\s*\+?\s*(?:${UNIT}|y)\b`,
    // "5–7 năm", "5-6 years" — a range starting at the number
    String.raw`${NUM}\s*(?:-|–|~)\s*\d+\s*\+?\s*(?:${UNIT}|yoe|y)\b`,
    // "react native 5 năm, non eng" — a bare figure followed by the usual
    // shorthand of a hiring line
    String.raw`${NUM}\s*${UNIT}\s*,\s*(?:non|ko\b|khong|co kn|eng|en\b|onboard)`,
].map((source) => new RegExp(source, "giu"));

/**
 * Every years-of-experience figure a post asks for, in order of appearance.
 *
 * @param {string} folded Text already passed through `fold`.
 * @returns {number[]}
 */
export function yearsAsked(folded) {
    const found = [];
    for (const pattern of PATTERNS) {
        for (const match of folded.matchAll(pattern)) {
            found.push({ at: match.index, years: Number(match[1].replace(",", ".")) });
        }
    }
    return found.sort((a, b) => a.at - b.at).map((hit) => hit.years);
}
