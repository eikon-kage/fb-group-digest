/**
 * Self-contained HTML report.
 *
 * Inline CSS only, no external requests — the same file has to survive being
 * opened from disk and being pasted into an email body.
 */

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
.stamp { color: #666; font-size: 12px; margin: 0 0 8px; }
.author { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
.author img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex: none; }
.author .who { font-weight: 600; font-size: 14px; }
.muted { color: #999; font-style: italic; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 8px; }
.stat { flex: 1 1 120px; padding: 12px; border: 1px solid #e5e5e5; border-radius: 8px; }
.stat b { display: block; font-size: 22px; line-height: 1.2; }
.stat span { color: #666; font-size: 12px; }
.digest { background: #f7f7f5; border-radius: 8px; padding: 4px 18px; margin: 16px 0 8px; }
.post { border: 1px solid #e5e5e5; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
.post-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
.tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eceff3; color: #333; }
.tag.hi { background: #fde8e8; color: #8a1c1c; }
.tag.score { background: #e6f0ff; color: #14417a; }
.summary { font-weight: 600; margin: 0 0 6px; }
.body { white-space: pre-wrap; color: #444; font-size: 14px; margin: 0 0 8px; }
a { color: #14417a; }
.foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #888; font-size: 12px; }
ul { padding-left: 20px; }
@media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #16171a; }
    h2, .foot { border-color: #303236; }
    .stat, .post { border-color: #303236; }
    .digest { background: #1e2024; }
    .meta, .stat span, .body, .stamp { color: #a8a8a8; }
    .muted { color: #8a8a8a; }
    .tag { background: #2a2d33; color: #d8d8d8; }
    .tag.hi { background: #4a1f1f; color: #ffbdbd; }
    .tag.score { background: #1c2f4d; color: #b8d4ff; }
    a { color: #8ab4ff; }
}
`;

/**
 * @param {object} input
 * @param {Array<object>} input.posts
 * @param {string} input.digest Markdown from `buildDigest`.
 * @param {object} input.stats
 * @returns {string}
 */
export function renderReport({ posts, digest, stats }) {
    const byGroup = groupBy(posts, (post) => post.groupName);
    const generated = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

    const sections = [...byGroup.entries()]
        .map(([groupName, groupPosts]) => {
            const cards = groupPosts.map(renderPost).join("");
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
 * @returns {string}
 */
function renderPost(post) {
    const analysis = post.analysis ?? {};
    const tags = [
        analysis.category ? `<span class="tag">${escapeHtml(analysis.category)}</span>` : "",
        analysis.urgency === "cao" ? `<span class="tag hi">gấp</span>` : "",
        post.score ? `<span class="tag score">điểm ${escapeHtml(post.score)}</span>` : "",
        ...(post.rules ?? []).map((rule) => `<span class="tag">${escapeHtml(rule)}</span>`),
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

    return `<div class="post">
    <div class="post-head">${tags}</div>
    ${renderAuthor(post)}
    <p class="stamp">${renderStamp(post)}</p>
    ${summary}
    <p class="body">${escapeHtml(post.text)}</p>
    ${entities}
    ${link}
</div>`;
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

/**
 * The provenance line: which group, when posted, when collected.
 *
 * `postedAt` is derived from Facebook's relative label ("17h"), so it is
 * approximate and says so. Posts whose label could not be read show the
 * collection time instead of an invented date.
 *
 * @param {object} post
 * @returns {string}
 */
function renderStamp(post) {
    const bits = [`<b>${escapeHtml(post.groupName ?? "?")}</b>`];

    const posted = post.postedAt ? formatWhen(post.postedAt) : null;
    if (posted !== null) {
        const label = post.timeLabel ? ` (${escapeHtml(post.timeLabel)})` : "";
        bits.push(`đăng khoảng ${escapeHtml(posted)}${label}`);
    } else {
        bits.push(`<span class="muted">không đọc được ngày đăng</span>`);
    }

    const collected = post.collectedAt ? formatWhen(post.collectedAt) : null;
    if (collected !== null) bits.push(`thu lúc ${escapeHtml(collected)}`);

    return bits.join(" · ");
}
