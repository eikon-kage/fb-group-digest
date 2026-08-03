/**
 * Self-contained HTML report.
 *
 * Inline CSS only, no external requests — the same file has to survive being
 * opened from disk and being pasted into an email body.
 */

import { tidy } from "../filter/normalize.js";

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/**
 * Minimal Markdown → HTML for the digest section: headings, bullets, bold,
 * paragraphs. Input is escaped first, so this cannot inject markup.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
    const blocks = escapeHtml(markdown).split(/\n{2,}/);

    return blocks
        .map((block) => {
            const lines = block.split("\n").filter((line) => line.trim() !== "");
            if (lines.length === 0) return "";

            if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
                const items = lines
                    .map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`)
                    .join("");
                return `<ul>${items}</ul>`;
            }

            return lines
                .map((line) => {
                    const heading = line.match(/^(#{1,4})\s+(.*)$/);
                    if (heading) {
                        const level = Math.min(heading[1].length + 1, 6);
                        return `<h${level}>${inline(heading[2])}</h${level}>`;
                    }
                    return `<p>${inline(line)}</p>`;
                })
                .join("");
        })
        .join("");
}

/**
 * @param {string} text Already HTML-escaped.
 * @returns {string}
 */
function inline(text) {
    return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Group posts by a field, preserving first-seen order.
 *
 * @param {Array<object>} posts
 * @param {(post: object) => string} keyOf
 * @returns {Map<string, Array<object>>}
 */
function groupBy(posts, keyOf) {
    const map = new Map();
    for (const post of posts) {
        const key = keyOf(post) || "(không rõ)";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(post);
    }
    return map;
}

const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
    margin: 0; padding: 24px;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1a1a1a; background: #fff;
}
.wrap { max-width: 860px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e5e5; }
h3 { font-size: 16px; margin: 20px 0 8px; }
.meta { color: #666; font-size: 13px; margin-bottom: 24px; }
.author { display: flex; align-items: center; gap: 8px; min-width: 0; }
.author img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex: none; }
.author .who { font-weight: 600; font-size: 14px; }
.muted { color: #999; font-style: italic; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 8px; }
.stat { flex: 1 1 120px; padding: 12px; border: 1px solid #e5e5e5; border-radius: 8px; }
.stat b { display: block; font-size: 22px; line-height: 1.2; }
.stat span { color: #666; font-size: 12px; }
.digest { background: #f7f7f5; border-radius: 8px; padding: 4px 18px; margin: 16px 0 8px; }
.post { border: 1px solid #e5e5e5; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }

/* Top row: who posted on the left, when on the right. */
.post-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.when {
    flex: none; font-size: 13px; font-weight: 600; white-space: nowrap;
    padding: 3px 10px; border-radius: 999px; background: #e6f0ff; color: #14417a;
}
.when.old { background: #eceff3; color: #444; }
.when.unknown { background: none; padding: 0; color: #999; font-style: italic; font-weight: 400; }

.post-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eceff3; color: #333; }
.tag.hi { background: #fde8e8; color: #8a1c1c; }
.summary { font-weight: 600; font-size: 15px; margin: 0 0 8px; }
.body { white-space: pre-wrap; color: #444; font-size: 14px; margin: 0; }

/* Long posts keep a short lead visible; the rest folds away. */
.rest { margin-top: 2px; }
.rest > summary {
    cursor: pointer; list-style: none; margin: 6px 0 0;
    font-size: 13px; font-weight: 600; color: #14417a;
}
.rest > summary::-webkit-details-marker { display: none; }
.rest > summary::before { content: "▸ "; }
.rest[open] > summary::before { content: "▾ "; }
.rest[open] > summary { margin-bottom: 4px; }

.post-foot {
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
    margin-top: 12px; padding-top: 10px; border-top: 1px dashed #e5e5e5; font-size: 13px;
}
.post-foot .note { color: #888; font-size: 12px; margin-left: auto; }
a { color: #14417a; }
.foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #888; font-size: 12px; }
ul { padding-left: 20px; }
@media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #16171a; }
    h2, .foot { border-color: #303236; }
    .stat, .post { border-color: #303236; }
    .post-foot { border-color: #303236; }
    .digest { background: #1e2024; }
    .meta, .stat span, .body, .post-foot .note { color: #a8a8a8; }
    .muted { color: #8a8a8a; }
    .tag { background: #2a2d33; color: #d8d8d8; }
    .tag.hi { background: #4a1f1f; color: #ffbdbd; }
    .when { background: #1c2f4d; color: #b8d4ff; }
    .when.old { background: #2a2d33; color: #c8c8c8; }
    .when.unknown { background: none; color: #8a8a8a; }
    .rest > summary { color: #8ab4ff; }
    a { color: #8ab4ff; }
}
`;

/**
 * Milliseconds since the epoch for a post, or null when Facebook withheld the
 * date. Used only for ordering.
 *
 * @param {object} post
 * @returns {number | null}
 */
function postedTime(post) {
    const at = Date.parse(post.postedAt ?? "");
    return Number.isNaN(at) ? null : at;
}

/**
 * Newest first. Posts with no readable date keep their collection order and
 * sink to the bottom rather than being scattered through the list.
 *
 * @param {Array<object>} posts
 * @returns {Array<object>}
 */
function byNewest(posts) {
    return posts
        .map((post, index) => ({ post, index, at: postedTime(post) }))
        .sort((a, b) => {
            if (a.at === null && b.at === null) return a.index - b.index;
            if (a.at === null) return 1;
            if (b.at === null) return -1;
            return b.at - a.at;
        })
        .map((entry) => entry.post);
}

/**
 * @param {object} input
 * @param {Array<object>} input.posts
 * @param {string} input.digest Markdown from `buildDigest`.
 * @param {object} input.stats
 * @param {Date} [now] Reference point for the "3 giờ trước" labels.
 * @returns {string}
 */
export function renderReport({ posts, digest, stats }, now = new Date()) {
    const byGroup = groupBy(posts, (post) => post.groupName);
    const generated = now.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

    const sections = [...byGroup.entries()]
        .map(([groupName, groupPosts]) => {
            const cards = byNewest(groupPosts)
                .map((post) => renderPost(post, now))
                .join("");
            return `<h2>${escapeHtml(groupName)} <span class="tag">${groupPosts.length} bài</span></h2>${cards}`;
        })
        .join("");

    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo nhóm Facebook — ${escapeHtml(generated)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<h1>Báo cáo nhóm Facebook</h1>
<p class="meta">Tạo lúc ${escapeHtml(generated)} (giờ Việt Nam)</p>

<div class="stats">
    <div class="stat"><b>${stats.collected}</b><span>bài thu thập</span></div>
    <div class="stat"><b>${stats.fresh}</b><span>bài mới</span></div>
    <div class="stat"><b>${stats.matched}</b><span>khớp bộ lọc</span></div>
    <div class="stat"><b>${stats.groups}</b><span>nhóm</span></div>
</div>

<div class="digest">${renderMarkdown(digest)}</div>

${sections || "<p>Không có bài nào khớp bộ lọc trong lần chạy này.</p>"}

<p class="foot">
Sinh tự động bởi fb-group-digest. Báo cáo chứa nội dung bài đăng, link tới bài,
và thông tin người đăng (tên, ảnh đại diện, link trang cá nhân).
</p>
</div>
</body>
</html>
`;
}

/**
 * @param {object} post
 * @param {Date} now
 * @returns {string}
 */
function renderPost(post, now) {
    const analysis = post.analysis ?? {};

    // Only what classifies the post stays on the badge row. Score and rule
    // names moved to the footer — they explain why it was kept, which is not
    // what the eye needs first.
    const tags = [
        analysis.category ? `<span class="tag">${escapeHtml(analysis.category)}</span>` : "",
        analysis.urgency === "cao" ? `<span class="tag hi">gấp</span>` : "",
    ]
        .filter(Boolean)
        .join("");

    const summary = analysis.summary
        ? `<p class="summary">${escapeHtml(analysis.summary)}</p>`
        : "";
    const entities = analysis.entities?.length
        ? `<p class="meta">Từ khoá: ${escapeHtml(analysis.entities.join(", "))}</p>`
        : "";
    const link = post.permalink
        ? `<a href="${escapeHtml(post.permalink)}" rel="noreferrer noopener">Mở bài trên Facebook →</a>`
        : `<span class="muted">Không lấy được link bài</span>`;

    const why = [
        post.score ? `điểm ${escapeHtml(post.score)}` : "",
        ...(post.rules ?? []).map(escapeHtml),
    ]
        .filter(Boolean)
        .join(" · ");
    const note = why ? `<span class="note">${why}</span>` : "";

    return `<div class="post">
    <div class="post-top">${renderAuthor(post) || "<span></span>"}${renderWhen(post, now)}</div>
    ${tags ? `<div class="post-head">${tags}</div>` : ""}
    ${summary}
    ${renderBody(post.text)}
    ${entities}
    <div class="post-foot">${link}${note}</div>
</div>`;
}

/** Characters of a post shown before the fold. */
const LEAD_LENGTH = 420;

/**
 * The post text, with anything past a few lines folded behind "Xem thêm".
 *
 * A group post runs to a couple of thousand characters, and a page of them
 * unbroken is unreadable. The split lands on a line or word boundary so the
 * lead never ends mid-word. `<details>` needs no script; a mail client that
 * ignores it simply shows the whole post, which is the old behaviour.
 *
 * @param {string} text
 * @returns {string}
 */
function renderBody(text) {
    const clean = tidy(text ?? "");
    if (clean === "") return "";
    if (clean.length <= LEAD_LENGTH) return `<p class="body">${escapeHtml(clean)}</p>`;

    const window = clean.slice(0, LEAD_LENGTH);
    const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const cut = breakAt > LEAD_LENGTH / 2 ? breakAt : LEAD_LENGTH;

    const lead = clean.slice(0, cut).trimEnd();
    const rest = clean.slice(cut).trimStart();

    return `<p class="body">${escapeHtml(lead)}…</p>
    <details class="rest"><summary>Xem thêm</summary><p class="body">${escapeHtml(rest)}</p></details>`;
}

/**
 * The poster: avatar, display name, link to their profile.
 *
 * @param {object} post
 * @returns {string}
 */
function renderAuthor(post) {
    if (!post.authorName && !post.authorAvatar) return "";

    const avatar = post.authorAvatar ? `<img src="${escapeHtml(post.authorAvatar)}" alt="">` : "";
    const name = escapeHtml(post.authorName ?? "(không rõ)");
    const who = post.authorUrl
        ? `<a class="who" href="${escapeHtml(post.authorUrl)}" rel="noreferrer noopener">${name}</a>`
        : `<span class="who">${name}</span>`;

    return `<div class="author">${avatar}${who}</div>`;
}

/** Vietnamese local time, or an honest note when Facebook withheld the date. */
function formatWhen(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "vừa xong" / "18 giờ trước" / "hôm qua" / "3 ngày trước", and a plain date
 * once a post is over a week old — by then "12 ngày trước" is harder to place
 * than "22/07/2026".
 *
 * @param {Date} date
 * @param {Date} now
 * @returns {{ text: string, old: boolean }}
 */
export function formatRelative(date, now) {
    // A post collected before the report was generated can still read as
    // slightly in the future when the two clocks disagree; clamp rather than
    // print "-1 phút trước".
    const elapsed = Math.max(0, now.getTime() - date.getTime());

    if (elapsed < MINUTE) return { text: "vừa xong", old: false };
    if (elapsed < HOUR) return { text: `${Math.floor(elapsed / MINUTE)} phút trước`, old: false };
    if (elapsed < DAY) return { text: `${Math.floor(elapsed / HOUR)} giờ trước`, old: false };
    if (elapsed < 2 * DAY) return { text: "hôm qua", old: false };
    if (elapsed < 7 * DAY) return { text: `${Math.floor(elapsed / DAY)} ngày trước`, old: true };

    return {
        text: date.toLocaleDateString("vi-VN", {
            timeZone: "Asia/Ho_Chi_Minh",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }),
        old: true,
    };
}

/**
 * The time badge, at the top right of every card.
 *
 * `postedAt` is derived from Facebook's relative label ("17h"), so it is
 * approximate — the badge reads relative to keep that honest, and the exact
 * timestamp plus the collection time sit in the tooltip for anyone who needs
 * them. Posts whose label could not be read say so instead of showing an
 * invented date.
 *
 * @param {object} post
 * @param {Date} now
 * @returns {string}
 */
function renderWhen(post, now) {
    const collected = post.collectedAt ? formatWhen(post.collectedAt) : null;
    const collectedNote = collected ? `Thu lúc ${collected}` : "";

    const at = post.postedAt ? new Date(post.postedAt) : null;
    if (at === null || Number.isNaN(at.getTime())) {
        const title = collectedNote || "Không có mốc thời gian nào";
        return `<span class="when unknown" title="${escapeHtml(title)}">không rõ giờ đăng</span>`;
    }

    const { text, old } = formatRelative(at, now);
    const title = [
        `Đăng khoảng ${formatWhen(at.toISOString())}`,
        post.timeLabel ? `Facebook ghi "${post.timeLabel}"` : "",
        collectedNote,
    ]
        .filter(Boolean)
        .join(" · ");

    return `<span class="when${old ? " old" : ""}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}
