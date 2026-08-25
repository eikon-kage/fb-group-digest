/**
 * Self-contained HTML report.
 *
 * Inline CSS only, no external requests — the same file has to survive being
 * opened from disk and being pasted into an email body.
 */

import { fold, tidy } from "../filter/normalize.js";
import { seenKeys } from "../store/seen.js";

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

            // A paragraph wrapped across several source lines is one paragraph,
            // not one per line — Claude hard-wraps its prose, and rendering each
            // line separately broke sentences in half with a gap in the middle.
            const out = [];
            let paragraph = [];
            const flush = () => {
                if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
                paragraph = [];
            };

            for (const line of lines) {
                const heading = line.match(/^(#{1,4})\s+(.*)$/);
                if (heading) {
                    flush();
                    const level = Math.min(heading[1].length + 1, 6);
                    out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
                } else {
                    paragraph.push(line.trim());
                }
            }
            flush();

            return out.join("");
        })
        .join("");
}

/**
 * @param {string} text Already HTML-escaped.
 * @returns {string}
 */
function inline(text) {
    return (
        text
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            // Only underscores that sit at a word boundary, so snake_case names
            // inside a post title survive intact.
            .replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:)!?])/g, "$1<em>$2</em>")
    );
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
    margin: 0; padding: 24px 20px 48px;
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1a1a1a; background: #f4f5f7;
}
.wrap { max-width: 780px; margin: 0 auto; }
a { color: #14417a; }
ul { padding-left: 20px; }
.muted { color: #999; font-style: italic; }

/* --- Header ---------------------------------------------------------- */
.head { margin-bottom: 20px; }
h1 { font-size: 25px; line-height: 1.25; margin: 0 0 4px; letter-spacing: -0.01em; }
.meta { color: #6b7079; font-size: 13px; margin: 0; }

/* --- Stats ----------------------------------------------------------- */
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
.stat {
    flex: 1 1 110px; padding: 10px 14px; background: #fff;
    border: 1px solid #e3e5e9; border-radius: 10px;
}
.stat b { display: block; font-size: 22px; line-height: 1.2; letter-spacing: -0.02em; }
.stat span { color: #6b7079; font-size: 12px; }

/* --- Digest ---------------------------------------------------------- */
.digest {
    background: #fff; border: 1px solid #e3e5e9; border-left: 4px solid #14417a;
    border-radius: 10px; padding: 4px 20px 14px; margin: 0 0 20px;
}
.digest .label {
    display: block; margin: 14px 0 0; font-size: 11px; font-weight: 700;
    letter-spacing: 0.09em; text-transform: uppercase; color: #6b7079;
}
.digest h3, .digest h4 { font-size: 16px; margin: 14px 0 6px; }
.digest p { margin: 8px 0; }
.digest li { margin-bottom: 4px; }

/* --- Group index: jump straight to a group instead of scrolling ------ */
.index { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 28px; }
.jump {
    display: inline-flex; align-items: baseline; gap: 6px; text-decoration: none;
    font-size: 13px; padding: 5px 12px; border-radius: 999px; max-width: 100%;
    background: #fff; border: 1px solid #dfe2e7; color: #2b3038;
}
/* Group names run long ("Tuyển dụng-Headhunt/Outsource IT (Fullstack, …)"),
   and one of them would otherwise take the whole index row. */
.jump span { max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jump b { font-weight: 700; color: #14417a; flex: none; }

/* --- Group section --------------------------------------------------- */
.group { margin-bottom: 34px; }
h2 {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    font-size: 18px; margin: 0 0 12px; padding-bottom: 8px;
    border-bottom: 2px solid #dfe2e7; letter-spacing: -0.01em;
}
h2 .count { font-size: 12px; font-weight: 600; color: #6b7079; }
h2 .top { margin-left: auto; font-size: 12px; font-weight: 400; text-decoration: none; }

/* --- Post card ------------------------------------------------------- */
.post {
    background: #fff; border: 1px solid #e3e5e9; border-radius: 10px;
    padding: 14px 16px; margin-bottom: 10px;
}
.post.hot { border-left: 4px solid #c62828; padding-left: 13px; }

/* Top row: who posted on the left, tags and when on the right. */
.post-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
.post-top .right { display: flex; align-items: center; gap: 6px; flex: none; }
.author { display: flex; align-items: center; gap: 8px; min-width: 0; }
.author img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; flex: none; }
.author .who {
    font-weight: 600; font-size: 14px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
}
.when { flex: none; font-size: 12.5px; font-weight: 600; white-space: nowrap; color: #14417a; }
.when.old { color: #6b7079; font-weight: 400; }
.when.unknown { color: #999; font-style: italic; font-weight: 400; }
/* A time we inferred rather than read: same shape as the real thing, dimmer. */
.when.approx { color: #6b7079; font-weight: 400; }

.tag {
    font-size: 11.5px; font-weight: 600; white-space: nowrap;
    padding: 2px 9px; border-radius: 999px; background: #eef0f4; color: #3a3f47;
}
.tag.hi { background: #fde8e8; color: #8a1c1c; }
/* Carried over from an earlier report: present, but not competing with today's
   posts for attention. The card keeps full contrast — dimming is what the read
   state means, and two meanings on one signal is one too many. */
.tag.past { background: transparent; border: 1px solid #dfe2e7; color: #8b9099; font-weight: 500; }
.post.past { border-left: 3px solid #e3e5e9; padding-left: 14px; }

/* The AI summary is the headline; the raw post is supporting detail. */
.summary { font-weight: 600; font-size: 15.5px; line-height: 1.45; margin: 0 0 8px; }
.body {
    white-space: pre-wrap; color: #4a4f57; font-size: 14px; line-height: 1.6;
    margin: 0; padding-left: 12px; border-left: 2px solid #ebedf1;
}
.kw { color: #6b7079; font-size: 12.5px; margin: 8px 0 0; }

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
    margin-top: 12px; padding-top: 10px; border-top: 1px solid #eef0f4; font-size: 13px;
}
.post-foot .note { color: #8b9099; font-size: 12px; }
/* Why-it-was-kept and the read button travel together on the right, so the
   button lands in the same place whether or not the note is there. */
.post-foot .right { display: flex; align-items: center; gap: 12px; margin-left: auto; }

.empty {
    background: #fff; border: 1px solid #e3e5e9; border-radius: 10px;
    padding: 24px; text-align: center; color: #6b7079;
}
.foot { margin-top: 36px; padding-top: 14px; border-top: 1px solid #dfe2e7; color: #8b9099; font-size: 12px; }

/* --- Toolbar: pick groups, hide what you have already read ----------- */
/* Everything below is progressive enhancement: without JavaScript (an email
   client, a printout) the toolbar and the buttons stay hidden and the report
   reads exactly as it did before. */
[hidden] { display: none !important; }
.js .index { display: none; }

.toolbar {
    position: sticky; top: 0; z-index: 5; margin: 0 0 22px;
    padding: 10px 12px; background: #fff; border: 1px solid #e3e5e9;
    border-radius: 12px; box-shadow: 0 2px 6px rgba(16, 20, 28, 0.06);
}
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bar + .bar { margin-top: 9px; padding-top: 9px; border-top: 1px solid #eef0f4; }
.search {
    flex: 1 1 170px; min-width: 130px; font: inherit; font-size: 13px;
    padding: 6px 10px; border: 1px solid #dfe2e7; border-radius: 8px;
    background: #f6f7f9; color: inherit;
}
.btn {
    font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
    padding: 6px 10px; border-radius: 8px; white-space: nowrap;
    border: 1px solid #dfe2e7; background: #fff; color: #2b3038;
}
.btn:hover { border-color: #aeb4bd; }
.btn[aria-pressed="true"] { background: #14417a; border-color: #14417a; color: #fff; }
.status { margin-left: auto; font-size: 12.5px; color: #6b7079; white-space: nowrap; }

/* The chip row is the group picker, and exactly one chip is active: the
   report shows a single group at a time. It scrolls instead of growing, so a
   config with thirty groups still leaves the first post above the fold. */
.chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 148px; overflow-y: auto; }
.chip {
    display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
    font: inherit; font-size: 13px; padding: 4px 11px; border-radius: 999px;
    border: 1px solid #dfe2e7; background: #fff; color: #2b3038; max-width: 100%;
}
.chip span { max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip b { font-size: 11.5px; font-weight: 700; color: #6b7079; }
.chip[aria-pressed="true"] { background: #eaf0fa; border-color: #14417a; color: #14417a; }
.chip[aria-pressed="true"] b { color: #14417a; }
.chip[aria-pressed="true"]::before { content: "✓"; font-size: 11px; }
.chip:hover { border-color: #aeb4bd; }

/* --- Read state ------------------------------------------------------ */
.read, h2 .mark-group { display: none; }
.js .read { display: inline-flex; align-items: center; gap: 5px; }
.js h2 .mark-group { display: inline-flex; font-size: 11.5px; padding: 3px 8px; }
h2 .mark-group { margin-left: auto; }
h2 .top + .mark-group, h2 .mark-group + .top { margin-left: 0; }
.post.is-read { opacity: 0.5; }
.post.is-read:hover { opacity: 1; }
.post.is-read .read { background: #edf6ed; border-color: #bcd8bc; color: #2c6b2c; }

@media (max-width: 560px) {
    body { padding: 16px 12px 32px; }
    /* Three narrow tiles beat two wide ones: five stats then cost two rows
       instead of three, and the numbers are still the biggest thing in them. */
    .stat { flex: 1 1 calc(33.333% - 6px); padding: 8px 10px; }
    .stat b { font-size: 19px; }
    .digest { padding: 4px 14px 12px; }
    .post-top { flex-wrap: wrap; }
    h2 .top { display: none; }
    /* Sticky costs a third of a phone screen once the chips wrap, so on
       narrow screens the toolbar scrolls away with the rest of the page. */
    .toolbar { position: static; padding: 8px 10px; }
    .status { margin-left: 0; width: 100%; }
    .chips { max-height: 116px; }
}

@media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #121316; }
    a { color: #8ab4ff; }
    .meta, .stat span, .kw, h2 .count { color: #9aa0a8; }
    .muted { color: #8a8a8a; }
    .stat, .post, .digest, .jump, .empty { background: #1b1d21; border-color: #2e3136; }
    .digest { border-left-color: #4a7fd4; }
    .digest .label { color: #9aa0a8; }
    .jump { color: #d8dade; }
    .jump b { color: #8ab4ff; }
    h2 { border-color: #2e3136; }
    .post.hot { border-left-color: #e05252; }
    .body { color: #b4b8be; border-left-color: #2e3136; }
    .post-foot { border-color: #2e3136; }
    .post-foot .note, .empty { color: #8f949b; }
    .tag { background: #2a2d33; color: #d8d8d8; }
    .tag.hi { background: #4a1f1f; color: #ffbdbd; }
    .when { color: #8ab4ff; }
    .when.old { color: #9aa0a8; }
    .when.unknown { color: #8a8a8a; }
    .when.approx { color: #9aa0a8; }
    .rest > summary { color: #8ab4ff; }
    .toolbar, .btn, .chip, .search { background: #1b1d21; border-color: #2e3136; color: #d8dade; }
    .bar + .bar { border-color: #2e3136; }
    .status, .chip b { color: #9aa0a8; }
    .btn:hover { border-color: #474c54; }
    .btn[aria-pressed="true"] { background: #4a7fd4; border-color: #4a7fd4; color: #fff; }
    .chip[aria-pressed="true"] { background: #24304a; border-color: #4a7fd4; color: #cfe0ff; }
    .chip[aria-pressed="true"] b { color: #cfe0ff; }
    .post.is-read .read { background: #1e2a1e; border-color: #31502f; color: #a9d9a5; }
    .tag.past { border-color: #3a3f47; color: #9aa0a8; }
    .post.past { border-left-color: #2e3136; }
    .foot { border-color: #2e3136; color: #8f949b; }
}

@media print {
    body { background: #fff; padding: 0; }
    .index, .rest > summary, .toolbar, .read, h2 .mark-group { display: none; }
    .rest[open], .rest { display: block; }
    .post, .stat, .digest { break-inside: avoid; }
}
`;

/**
 * The only script in the report, and everything it drives is optional: group
 * selection and the "đã đọc" buttons. A mail client that strips scripts shows
 * the report exactly as before, so the same file works in both places.
 *
 * Read state is kept in localStorage under the post's permalink id — the same
 * key `store/seen.js` uses — so ticking a post off here survives reopening the
 * file and recognises the same post in a later report.
 */
const SCRIPT = `
(function () {
    var KEY_READ = "fbgd:read:v1";
    var KEY_VIEW = "fbgd:view:v1";
    var KEEP_DAYS = 90;

    function load(key, fallback) {
        try {
            var raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            // file:// in some browsers, or storage turned off: the page still
            // works, it just forgets between reloads.
            return fallback;
        }
    }

    function save(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {}
    }

    // Null-prototype maps: a group called "constructor" must not read as
    // already-hidden, the same trap store/seen.js guards against.
    var read = Object.assign(Object.create(null), load(KEY_READ, {}));
    var cutoff = new Date().getTime() - KEEP_DAYS * 86400000;
    Object.keys(read).forEach(function (key) {
        var at = Date.parse(read[key]);
        if (!isNaN(at) && at < cutoff) delete read[key];
    });

    var view = load(KEY_VIEW, {}) || {};
    var hideRead = view.hideRead !== false;
    var onlyUrgent = view.onlyUrgent === true;
    var onlyNew = view.onlyNew === true;
    // One group is on screen at a time, so the view remembers which one it is
    // rather than a set of the ones switched off.
    var current = typeof view.group === "string" ? view.group : null;

    var toolbar = document.querySelector(".toolbar");
    if (!toolbar) return;

    var sections = [].slice.call(document.querySelectorAll(".group"));
    var chips = [].slice.call(document.querySelectorAll(".chip"));
    var search = toolbar.querySelector(".search");
    var status = toolbar.querySelector(".status");
    var nothing = document.getElementById("nothing");
    var buttons = {};
    [].slice.call(toolbar.querySelectorAll("[data-act]")).forEach(function (button) {
        buttons[button.getAttribute("data-act")] = button;
    });

    var chipOf = {};
    chips.forEach(function (chip) { chipOf[chip.getAttribute("data-target")] = chip; });

    var names = sections.map(function (section) { return section.getAttribute("data-name"); });
    // A remembered group missing from today's report (renamed, or simply no
    // posts this run) falls back to the first one instead of a blank page.
    if (names.indexOf(current) === -1) current = names[0];

    function fold(text) {
        return text
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/đ/g, "d");
    }

    function keyOf(node) { return node.getAttribute("data-key"); }

    function saveView() {
        save(KEY_VIEW, {
            hideRead: hideRead,
            onlyUrgent: onlyUrgent,
            onlyNew: onlyNew,
            group: current,
        });
    }

    function setRead(post, value) {
        var key = keyOf(post);
        if (!key) return;
        if (value) read[key] = new Date().toISOString();
        else delete read[key];
    }

    function apply() {
        var query = search ? fold(search.value.trim()) : "";
        var shown = 0;
        var done = 0;
        var total = 0;

        sections.forEach(function (section) {
            var on = section.getAttribute("data-name") === current;
            var posts = [].slice.call(section.querySelectorAll(".post"));
            var visible = 0;
            var unread = 0;

            posts.forEach(function (post) {
                var isRead = Boolean(read[keyOf(post)]);
                var urgent = post.getAttribute("data-urgent") === "1";
                var fresh = post.getAttribute("data-new") === "1";
                var show =
                    on &&
                    !(hideRead && isRead) &&
                    !(onlyUrgent && !urgent) &&
                    !(onlyNew && !fresh);

                post.classList.toggle("is-read", isRead);
                post.hidden = !show;

                var button = post.querySelector(".read");
                if (button) {
                    button.textContent = isRead ? "↺ Bỏ đánh dấu" : "✓ Đã đọc";
                    button.setAttribute("aria-pressed", isRead ? "true" : "false");
                }

                if (!isRead) unread++;
                if (on) {
                    total++;
                    if (isRead) done++;
                }
                if (show) visible++;
            });

            section.hidden = !on || visible === 0;
            shown += visible;

            var chip = chipOf[section.id];
            if (chip) {
                chip.setAttribute("aria-pressed", on ? "true" : "false");
                chip.querySelector("b").textContent = unread;
                // The active chip stays put through a search, so the reader
                // never loses sight of which group they are in.
                chip.hidden =
                    !on && query !== "" && chip.getAttribute("data-fold").indexOf(query) === -1;
            }
        });

        if (status) {
            var place =
                names.length > 1 ? "Nhóm " + (names.indexOf(current) + 1) + "/" + names.length + " · " : "";
            status.textContent =
                place + "Hiện " + shown + "/" + total + " bài" + (done > 0 ? " · " + done + " đã đọc" : "");
        }
        if (nothing) nothing.hidden = shown !== 0;
        if (buttons["hide-read"]) {
            buttons["hide-read"].setAttribute("aria-pressed", hideRead ? "true" : "false");
        }
        if (buttons["only-urgent"]) {
            buttons["only-urgent"].setAttribute("aria-pressed", onlyUrgent ? "true" : "false");
        }
        if (buttons["only-new"]) {
            buttons["only-new"].setAttribute("aria-pressed", onlyNew ? "true" : "false");
        }
        if (buttons["clear-read"]) buttons["clear-read"].hidden = done === 0;
    }

    document.addEventListener("click", function (event) {
        var el = event.target.closest ? event.target.closest("[data-act]") : null;
        if (!el) return;
        var act = el.getAttribute("data-act");
        // Switching group replaces the whole page below the toolbar, so the
        // reader is sent back to the first card of the new group.
        var rewind = false;

        if (act === "group") {
            current = el.getAttribute("data-name");
            rewind = true;
            saveView();
        } else if (act === "prev" || act === "next") {
            // Wrapping: stepping past the last group lands on the first.
            var at = names.indexOf(current);
            current = names[(at + (act === "next" ? 1 : names.length - 1)) % names.length];
            rewind = true;
            saveView();
        } else if (act === "hide-read") {
            hideRead = !hideRead;
            saveView();
        } else if (act === "only-urgent") {
            onlyUrgent = !onlyUrgent;
            saveView();
        } else if (act === "only-new") {
            onlyNew = !onlyNew;
            saveView();
        } else if (act === "clear-read") {
            read = Object.create(null);
            save(KEY_READ, read);
        } else if (act === "read") {
            var post = el.closest(".post");
            setRead(post, !read[keyOf(post)]);
            save(KEY_READ, read);
        } else if (act === "mark-group") {
            var posts = [].slice.call(el.closest(".group").querySelectorAll(".post"));
            var allRead = posts.every(function (post) { return read[keyOf(post)]; });
            posts.forEach(function (post) { setRead(post, !allRead); });
            save(KEY_READ, read);
        } else {
            return;
        }

        apply();
        if (rewind) {
            // With twenty-five groups the chip row scrolls, so the chip that
            // just became active is pulled back into view before the page is
            // rewound to the first card.
            var active = chips.filter(function (chip) { return chip.getAttribute("data-name") === current; })[0];
            if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
            window.scrollTo(0, 0);
        }
    });

    if (search) {
        search.addEventListener("input", apply);
        // Escape clears the box rather than leaving groups mysteriously hidden.
        search.addEventListener("keydown", function (event) {
            if (event.key === "Escape") { search.value = ""; apply(); }
        });
    }

    toolbar.hidden = false;
    apply();
})();
`;

/**
 * Stable identity for a post's read state.
 *
 * Same rule as `store/seen.js`: the permalink's numeric id when Facebook gave
 * one, because the text fingerprint changes the moment "See more" is expanded.
 *
 * @param {object} post
 * @returns {string}
 */
function postKey(post) {
    const keys = seenKeys(post).filter(Boolean);
    return keys.find((key) => key.startsWith("p:")) ?? keys[0] ?? "";
}

/**
 * The filter bar: which group is on screen, and what to do with posts already
 * ticked off. Rendered hidden and revealed by the script, so a mail client
 * that drops scripts never shows dead controls.
 *
 * @param {Array<{ name: string, anchor: string, posts: Array<object> }>} groups
 * @param {boolean} hasPrevious Whether any post was carried over from an
 *   earlier run — without one, "chỉ bài mới" would filter nothing.
 * @returns {string}
 */
function renderToolbar(groups, hasPrevious = false) {
    // One group needs no picker, but the read/urgent filters still earn their
    // place, so only the chip row is conditional.
    //
    // Exactly one chip is pressed: the script shows a single group at a time,
    // and the first one is what it opens on.
    const chips =
        groups.length > 1
            ? `<div class="bar chips">${groups
                  .map(
                      (group, index) =>
                          `<button type="button" class="chip" data-act="group" data-target="${group.anchor}" data-name="${escapeHtml(group.name)}" data-fold="${escapeHtml(fold(group.name))}" aria-pressed="${index === 0 ? "true" : "false"}" title="${escapeHtml(group.name)} — bấm để xem nhóm này"><span>${escapeHtml(group.name)}</span> <b>${group.posts.length}</b></button>`,
                  )
                  .join("")}</div>`
            : "";

    const search =
        groups.length > 1
            ? `<input class="search" type="search" placeholder="Tìm nhóm…" aria-label="Tìm nhóm">
        <button type="button" class="btn" data-act="prev" title="Xem nhóm trước">‹ Nhóm trước</button>
        <button type="button" class="btn" data-act="next" title="Xem nhóm sau">Nhóm sau ›</button>`
            : "";

    const onlyNew = hasPrevious
        ? `<button type="button" class="btn" data-act="only-new" aria-pressed="false" title="Ẩn các bài đã có trong báo cáo trước">Chỉ bài mới</button>`
        : "";

    return `<div class="toolbar" hidden>
    <div class="bar">${search}
        ${onlyNew}
        <button type="button" class="btn" data-act="only-urgent" aria-pressed="false">Chỉ gấp</button>
        <button type="button" class="btn" data-act="hide-read" aria-pressed="true">Ẩn đã đọc</button>
        <button type="button" class="btn" data-act="clear-read" hidden>Xoá đánh dấu</button>
        <span class="status"></span>
    </div>
    ${chips}
</div>`;
}

/**
 * Milliseconds since the epoch for a post. Used for ordering and for the time
 * badge.
 *
 * Facebook hides the date on most posts we can read (348 of 405 in a recent
 * run), and burying all of them under the handful it did label made the newest
 * scrape unreadable. So an undated post is dated by the run that collected it:
 * everything picked up today sorts as today, and leftovers from an older run
 * stay back on the day they were seen rather than all claiming to be new.
 *
 * @param {object} post
 * @returns {{ at: number, exact: boolean } | null} null only when the post
 *   carries no timestamp at all.
 */
function postedTime(post) {
    const posted = Date.parse(post.postedAt ?? "");
    if (!Number.isNaN(posted)) return { at: posted, exact: true };

    const collected = Date.parse(post.collectedAt ?? "");
    return Number.isNaN(collected) ? null : { at: collected, exact: false };
}

/** @param {object} post */
function isUrgent(post) {
    return post.analysis?.urgency === "cao";
}

/**
 * Urgent posts first, then newest first, with an undated post standing on the
 * time it was collected (see `postedTime`) — which puts this run's undated
 * posts at the top, where the freshest thing on the page belongs. Only a post
 * with no timestamp at all keeps its collection order and sinks to the bottom
 * of its band.
 *
 * The urgency band is the only reordering: a group section is meant to be read
 * top to bottom and stopped at any point, so whatever Claude marked as "cao"
 * has to survive being read for ten seconds. A post carried over from an
 * earlier run does not enter that band even when it is marked urgent — it had
 * its turn at the top of the report it first appeared in, and hoisting week-old
 * posts above today's would defeat the point of reading top to bottom.
 *
 * @param {Array<object>} posts
 * @returns {Array<object>}
 */
function byUrgencyThenNewest(posts) {
    return posts
        .map((post, index) => ({
            post,
            index,
            at: postedTime(post)?.at ?? null,
            hot: isUrgent(post) && !post.previous,
        }))
        .sort((a, b) => {
            if (a.hot !== b.hot) return a.hot ? -1 : 1;
            if (a.at === null && b.at === null) return a.index - b.index;
            if (a.at === null) return 1;
            if (b.at === null) return -1;
            return b.at - a.at;
        })
        .map((entry) => entry.post);
}

/**
 * Anchor id for a group heading, derived from the name so the link stays
 * readable. Names that fold to nothing (or collide) fall back to a counter.
 *
 * @param {string} name
 * @param {number} index
 * @param {Set<string>} taken
 * @returns {string}
 */
function anchorFor(name, index, taken) {
    const base = fold(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    let id = base ? `nhom-${base}` : `nhom-${index + 1}`;
    if (taken.has(id)) id = `${id}-${index + 1}`;
    taken.add(id);
    return id;
}

/**
 * @param {object} input
 * @param {Array<object>} input.posts This run's posts.
 * @param {Array<object>} [input.previous] Posts earlier runs already reported,
 *   carried over so a thin run still reads as a digest. Marked `previous`.
 * @param {string} input.digest Markdown from `buildDigest`.
 * @param {object} input.stats
 * @param {Date} [now] Reference point for the "3 giờ trước" labels.
 * @returns {string}
 */
export function renderReport({ posts, previous = [], digest, stats }, now = new Date()) {
    const all = [...posts, ...previous];
    const byGroup = groupBy(all, (post) => post.groupName);
    const generated = `${vnDate(now)} ${vnTime(now)}`;

    const taken = new Set();
    const groups = [...byGroup.entries()].map(([name, groupPosts], index) => ({
        name,
        posts: byUrgencyThenNewest(groupPosts),
        anchor: anchorFor(name, index, taken),
    }));

    // With a dozen groups the report is several screens long, so the reader
    // gets a row of jump links before the first card. One group needs no index.
    const index =
        groups.length > 1
            ? `<nav class="index">${groups
                  .map(
                      (group) =>
                          `<a class="jump" href="#${group.anchor}" title="${escapeHtml(group.name)}"><span>${escapeHtml(group.name)}</span> <b>${group.posts.length}</b></a>`,
                  )
                  .join("")}</nav>`
            : "";

    const urgent = posts.filter(isUrgent).length;
    const sections = groups
        .map((group) => {
            const cards = group.posts.map((post) => renderPost(post, now)).join("");
            const hot = group.posts.filter(isUrgent).length;
            const count = `${group.posts.length} bài${hot > 0 ? ` · ${hot} gấp` : ""}`;
            return `<section class="group" id="${group.anchor}" data-name="${escapeHtml(group.name)}">
<h2>${escapeHtml(group.name)} <span class="count">${count}</span>${
                groups.length > 1 ? `<a class="top" href="#top">↑ đầu trang</a>` : ""
            }<button type="button" class="btn mark-group" data-act="mark-group">✓ Cả nhóm</button></h2>
${cards}</section>`;
        })
        .join("");

    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo nhóm Facebook — ${escapeHtml(generated)}</title>
<style>${STYLES}</style>
<script>document.documentElement.className = "js";</script>
</head>
<body id="top">
<div class="wrap">
<div class="head">
    <h1>Báo cáo nhóm Facebook</h1>
    <p class="meta">Tạo lúc ${escapeHtml(generated)} (giờ Việt Nam)</p>
</div>

<div class="stats">
    <div class="stat"><b>${stats.collected}</b><span>bài thu thập</span></div>
    <div class="stat"><b>${stats.fresh}</b><span>bài mới</span></div>
    <div class="stat"><b>${stats.matched}</b><span>khớp bộ lọc</span></div>
    <div class="stat"><b>${urgent}</b><span>đánh dấu gấp</span></div>
    <div class="stat"><b>${stats.groups}</b><span>nhóm</span></div>
    ${
        previous.length > 0
            ? `<div class="stat"><b>${previous.length}</b><span>từ lần trước</span></div>`
            : ""
    }
</div>

<div class="digest"><span class="label">Tóm tắt</span>${renderMarkdown(digest)}</div>

${all.length > 0 ? renderToolbar(groups, previous.length > 0) : ""}
${index}
${sections || `<p class="empty">Không có bài nào khớp bộ lọc trong lần chạy này.</p>`}
${all.length > 0 ? `<p class="empty" id="nothing" hidden>Bộ lọc hiện tại không còn bài nào. Bỏ bớt nhóm đã tắt, hoặc bấm “Ẩn đã đọc” để xem lại các bài đã đánh dấu.</p>` : ""}

<p class="foot">
Sinh tự động bởi fb-group-digest. Báo cáo chứa nội dung bài đăng, link tới bài,
và thông tin người đăng (tên, ảnh đại diện, link trang cá nhân).
</p>
</div>
<script>${SCRIPT}</script>
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

    // Only what classifies the post stays on the badge row, and that row is the
    // header row — a card used to spend a whole line on two small pills. Score
    // and rule names sit in the footer: they explain why the post was kept,
    // which is not what the eye needs first.
    const tags = [
        post.previous
            ? `<span class="tag past" title="${escapeHtml(reportedNote(post))}">lần trước</span>`
            : "",
        analysis.category ? `<span class="tag">${escapeHtml(analysis.category)}</span>` : "",
        isUrgent(post) ? `<span class="tag hi">gấp</span>` : "",
    ]
        .filter(Boolean)
        .join("");

    const summary = analysis.summary
        ? `<p class="summary">${escapeHtml(analysis.summary)}</p>`
        : "";
    const entities = analysis.entities?.length
        ? `<p class="kw">Từ khoá: ${escapeHtml(analysis.entities.join(", "))}</p>`
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

    // No key means no way to remember the tick across reloads, so the button
    // is left out rather than offered and silently forgotten.
    const key = postKey(post);
    const readButton = key
        ? `<button type="button" class="btn read" data-act="read" aria-pressed="false">✓ Đã đọc</button>`
        : "";

    return `<article class="post${isUrgent(post) && !post.previous ? " hot" : ""}${
        post.previous ? " past" : ""
    }" data-key="${escapeHtml(key)}"${isUrgent(post) ? ` data-urgent="1"` : ""}${
        post.previous ? "" : ` data-new="1"`
    }>
    <div class="post-top">${renderAuthor(post) || "<span></span>"}
        <div class="right">${tags}${renderWhen(post, now)}</div>
    </div>
    ${summary}
    ${renderBody(post.text)}
    ${entities}
    <div class="post-foot">${link}<span class="right">${note}${readButton}</span></div>
</article>`;
}

/**
 * When this post was first reported, for the "lần trước" tag's tooltip.
 *
 * @param {object} post
 * @returns {string}
 */
function reportedNote(post) {
    const at = post.reportedAt ? formatWhen(post.reportedAt) : null;
    return at ? `Đã có trong báo cáo ${at}` : "Đã có trong một báo cáo trước";
}

/** Characters of a post shown before the fold. */
const LEAD_LENGTH = 420;

/**
 * Lines shown before the fold, whatever the character count.
 *
 * Job ads and for-sale posts are written as a stack of very short lines, so
 * they stay under LEAD_LENGTH while still filling half a screen. Counting
 * lines as well keeps every card roughly the same height.
 */
const LEAD_LINES = 7;

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
    // `tidy` collapses runs of spaces but leaves the one that survives at the
    // start of a line; under `white-space: pre-wrap` that shows up as a ragged
    // left edge down the whole card.
    const clean = tidy(text ?? "")
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
    if (clean === "") return "";

    // Whichever limit the post hits first decides where the fold goes.
    const lineCut = nthLineBreak(clean, LEAD_LINES);
    const limit = Math.min(LEAD_LENGTH, lineCut ?? LEAD_LENGTH);
    if (clean.length <= limit) return `<p class="body">${escapeHtml(clean)}</p>`;

    const window = clean.slice(0, limit);
    const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const cut = breakAt > limit / 2 ? breakAt : limit;

    const lead = clean.slice(0, cut).trimEnd();
    const rest = clean.slice(cut).trimStart();

    return `<p class="body">${escapeHtml(lead)}…</p>
    <details class="rest"><summary>Xem thêm</summary><p class="body">${escapeHtml(rest)}</p></details>`;
}

/**
 * Offset of the nth line break, or null when the text has fewer lines.
 *
 * @param {string} text
 * @param {number} n
 * @returns {number | null}
 */
function nthLineBreak(text, n) {
    let at = -1;
    for (let i = 0; i < n; i++) {
        at = text.indexOf("\n", at + 1);
        if (at === -1) return null;
    }
    return at;
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

const VN = { timeZone: "Asia/Ho_Chi_Minh" };

/**
 * "25/08/2026", Vietnamese order.
 *
 * @param {Date} date
 * @returns {string}
 */
function vnDate(date) {
    return date.toLocaleDateString("vi-VN", {
        ...VN,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

/**
 * "18:35", 24-hour.
 *
 * @param {Date} date
 * @returns {string}
 */
function vnTime(date) {
    return date.toLocaleTimeString("vi-VN", {
        ...VN,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

/**
 * Vietnamese local time as "25/08/2026 18:35", or null when Facebook withheld
 * the date.
 *
 * Date first, then the clock: `toLocaleString("vi-VN")` puts the time in front
 * ("18:35 25/08/2026"), which reads backwards to a Vietnamese reader, so the
 * two halves are formatted apart and joined in the expected order.
 *
 * @param {string} iso
 * @returns {string | null}
 */
function formatWhen(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return `${vnDate(date)} ${vnTime(date)}`;
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

    return { text: vnDate(date), old: true };
}

/**
 * The time badge, at the top right of every card.
 *
 * `postedAt` is derived from Facebook's relative label ("17h"), so it is
 * approximate — the badge reads relative to keep that honest, and the exact
 * timestamp plus the collection time sit in the tooltip for anyone who needs
 * them.
 *
 * A post whose label could not be read shows the time it was collected instead,
 * prefixed with "≈" and greyed: it is where the post sits in the order, not a
 * claim about when it was written, and the tooltip says as much. Only a post
 * with no timestamp at all still reads "không rõ giờ đăng".
 *
 * @param {object} post
 * @param {Date} now
 * @returns {string}
 */
function renderWhen(post, now) {
    const collected = post.collectedAt ? formatWhen(post.collectedAt) : null;
    const collectedNote = collected ? `Thu lúc ${collected}` : "";

    const when = postedTime(post);
    if (when === null) {
        const title = collectedNote || "Không có mốc thời gian nào";
        return `<span class="when unknown" title="${escapeHtml(title)}">không rõ giờ đăng</span>`;
    }

    const at = new Date(when.at);
    const { text, old } = formatRelative(at, now);
    if (!when.exact) {
        const title = ["Facebook không cho biết giờ đăng — xếp theo lúc thu", collectedNote]
            .filter(Boolean)
            .join(" · ");
        return `<span class="when approx" title="${escapeHtml(title)}">≈ ${escapeHtml(text)}</span>`;
    }

    const title = [
        `Đăng khoảng ${formatWhen(at.toISOString())}`,
        post.timeLabel ? `Facebook ghi "${post.timeLabel}"` : "",
        collectedNote,
    ]
        .filter(Boolean)
        .join(" · ");

    return `<span class="when${old ? " old" : ""}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}
