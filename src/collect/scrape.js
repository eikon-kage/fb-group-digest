/**
 * Group feed collection.
 *
 * Scope note: this reads posts already visible to the signed-in account — the
 * text, the post's own permalink, and the poster's display name, avatar and
 * profile link. That last part is identity data: the output is enough to build
 * a contact list, so treat the files it writes accordingly.
 *
 * Four things about Facebook's group feed shape this file:
 *
 * 1. The feed is virtualized. Posts scrolled past are unmounted from the DOM,
 *    so a single extraction after all the scrolling returns only whatever
 *    happens to be on screen at the end. Posts are harvested after every
 *    scroll step instead, and accumulated by permalink.
 *
 * 2. `role="article"` sits on posts *and* on comments. Only comments carry an
 *    aria-label ("Comment by <name> 9 hours ago"), so that label — not the role
 *    — is what tells them apart. A post is located from its message node.
 *
 * 3. A post card's `innerText` is padded with decoy text — dozens of visible,
 *    normally-styled spans reading "Facebook", plus strings broken up with
 *    zero-width joiners. Text is therefore read from the post's message node
 *    only, never from the whole card.
 *
 * 4. A post's own metadata is withheld until touched. Its timestamp is split
 *    one character per element, shuffled, and put back in visual order by CSS;
 *    `paintedText` reads it back by laid-out position. Its permalink anchor
 *    starts as a bare tracking query and is rewritten to the real URL only on a
 *    genuine hover, which `primeTimestamps` performs.
 */

import { envBool, envInt } from "../config.js";
import { parsePostedAt } from "../filter/dates.js";
import { fingerprint, tidy } from "../filter/normalize.js";
import { log, sleep } from "../logger.js";
import { isSeen, seenKeys } from "../store/seen.js";
import { assertNotCheckpointed } from "./browser.js";

/** Labels Facebook uses on the "show the rest of this post" control. */
const EXPAND_LABELS = ["Xem thêm", "See more", "Xem thêm…"];

/** Trailing expand-control text that survives when the click was refused. */
const TRAILING_EXPAND = /\s*(See more|Xem thêm)…?\s*$/;

/** Stop scrolling after this many consecutive scrolls that yield nothing new. */
const BARREN_SCROLL_LIMIT = 4;

/** Below twice the 900px viewport, so few posts scroll by unhovered. */
const SCROLL_STEP_PX = 1600;

/** Upper bound on hovers per scroll step; only a handful are ever on screen. */
const PRIME_ATTEMPTS_PER_STEP = 12;

/**
 * Force the chronological feed ordering.
 *
 * The group's own sort control ("New posts") sets this query parameter. Without
 * it the feed is ranked by engagement, and "scroll until we reach posts older
 * than N days" has no meaning — old and new posts are interleaved.
 *
 * @param {string} url
 * @returns {string}
 */
export function chronologicalUrl(url) {
    const parsed = new URL(url);
    parsed.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    return parsed.toString();
}

/**
 * Walk one group's feed and return its posts, newest first.
 *
 * @param {import("playwright").Page} page
 * @param {{ id?: string, name?: string, url: string }} group
 * @param {{ seen?: Record<string, string> }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function collectGroup(page, group, options = {}) {
    const maxScrolls = envInt("SCROLLS_PER_GROUP", 120);
    const maxPosts = envInt("MAX_POSTS_PER_GROUP", 60);
    // Walking back into already-reported territory means the new posts have
    // been passed. A margin is allowed because pinned posts and the odd
    // out-of-order card sit above the chronological run.
    const seenStopLimit = envInt("STOP_AFTER_SEEN", 20);
    const seen = options.seen ?? {};
    const alreadySeen = new Set();

    log.step(`Nhóm: ${group.name ?? group.url}`);

    await page.goto(chronologicalUrl(group.url), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
    });
    assertNotCheckpointed(page);

    try {
        await page.waitForSelector('[role="feed"]', { timeout: 20_000 });
    } catch {
        log.warn("Không thấy feed — nhóm có thể trống, hoặc bạn chưa được duyệt vào nhóm.");
        return [];
    }

    /** @type {Map<string, object>} keyed by permalink (or text fingerprint). */
    const collected = new Map();
    let barrenScrolls = 0;

    const collectAuthors = envBool("COLLECT_AUTHORS", true);
    await page.evaluate((on) => {
        window.__fbdigestAuthors = on;
    }, collectAuthors);

    for (let step = 0; step < maxScrolls; step++) {
        await expandTruncatedPosts(page);
        await primeTimestamps(page);

        const before = collected.size;
        for (const raw of await page.evaluate(extractPosts)) {
            const post = normalizePost(raw, group);
            if (post.text.length < 20) continue;

            if (isSeen(seen, post)) {
                for (const key of seenKeys(post)) alreadySeen.add(key);
                continue;
            }

            // A post first seen before its timestamp was hovered arrives with
            // no link and no date. Later steps get another chance at both, so
            // an existing entry is upgraded rather than skipped.
            const fpKey = `fp:${post.id}`;
            const key = post.permalink ?? fpKey;
            const existing = collected.get(key) ?? collected.get(fpKey);

            if (existing) {
                if (existing.permalink === null) existing.permalink = post.permalink;
                if (existing.postedAt === null && post.postedAt !== null) {
                    existing.postedAt = post.postedAt;
                    existing.timeLabel = post.timeLabel;
                }
                continue;
            }

            collected.set(key, post);
        }

        // The feed is chronological, so the run walks back through it until the
        // post cap is hit, the seen index says the new posts are behind us, or
        // the feed stops yielding anything at all.
        if (collected.size >= maxPosts) break;
        if (seenStopLimit > 0 && alreadySeen.size >= seenStopLimit) {
            log.info(`Gặp ${alreadySeen.size} bài đã lấy lần trước — dừng ở đây.`);
            break;
        }
        barrenScrolls = collected.size === before ? barrenScrolls + 1 : 0;
        if (barrenScrolls >= BARREN_SCROLL_LIMIT) break;

        // Shorter than the viewport on purpose: every timestamp link has to
        // pass through the visible area on some step, or it never gets hovered
        // and the post ends up with no link. It is not randomized to look human.
        await page.mouse.wheel(0, SCROLL_STEP_PX);
        await sleep(1200);
        assertNotCheckpointed(page);
    }

    const posts = [...collected.values()].slice(0, maxPosts);
    if (envBool("INLINE_AVATARS", true)) await inlineAvatars(page, posts);

    const linked = posts.filter((post) => post.permalink !== null).length;
    const dated = posts.filter((post) => post.postedAt !== null).length;

    log.info(
        `Lấy được ${posts.length} bài mới (${linked} có link, ${dated} có ngày)` +
            (alreadySeen.size > 0 ? `, bỏ qua ${alreadySeen.size} bài đã lấy lần trước` : "") +
            ".",
    );

    return posts;
}

/**
 * Replace avatar URLs with data URIs.
 *
 * Facebook serves avatars from short-lived signed scontent URLs, so a report
 * saved today shows broken images in a few days. Fetching through the browser
 * context reuses its cookies, which those URLs require.
 *
 * @param {import("playwright").Page} page
 * @param {Array<object>} posts Mutated in place.
 */
async function inlineAvatars(page, posts) {
    const cache = new Map();

    for (const post of posts) {
        const url = post.authorAvatar;
        if (typeof url !== "string" || !url.startsWith("http")) continue;

        if (!cache.has(url)) {
            try {
                const response = await page.request.get(url, { timeout: 10_000 });
                if (!response.ok()) throw new Error(String(response.status()));
                const type = response.headers()["content-type"] ?? "image/jpeg";
                const body = await response.body();
                cache.set(url, `data:${type};base64,${body.toString("base64")}`);
            } catch {
                // Keep the original URL: a link that may expire beats no avatar.
                cache.set(url, url);
            }
        }

        post.authorAvatar = cache.get(url);
    }
}

/**
 * Click every visible "See more" so the post text is not truncated mid-sentence.
 *
 * @param {import("playwright").Page} page
 */
async function expandTruncatedPosts(page) {
    for (const label of EXPAND_LABELS) {
        const buttons = page.getByRole("button", { name: label, exact: false });
        const count = Math.min(await buttons.count(), 25);
        for (let i = 0; i < count; i++) {
            try {
                await buttons.nth(i).click({ timeout: 1000 });
            } catch {
                // The node was re-rendered or is off-screen; the truncated text
                // is still usable, so move on.
            }
        }
    }
}

/**
 * Hover every post's timestamp link so Facebook fills in its real href.
 *
 * A post header's timestamp starts out pointing at a bare "?__cft__[0]=…"
 * tracking query, which resolves to the group, not the post. Facebook rewrites
 * it to the true permalink on hover — and only on a genuine one: events
 * dispatched from page script are ignored, so this drives the real mouse.
 *
 * The mouse is moved by coordinate rather than through `locator.hover()`,
 * which scrolls its target into view first. In a virtualized feed that scroll
 * re-renders the list and unmounts the anchors queued behind it, so a third of
 * the hovers used to time out waiting for an element that had just been
 * removed. Only anchors already on screen are touched; the rest come into view
 * on a later scroll step, and the harvest merges the link in then.
 *
 * @param {import("playwright").Page} page
 */
async function primeTimestamps(page) {
    let moved = 0;

    // Two passes, in order of cost. First the mouse visits anchors already on
    // screen: cheap, and it disturbs nothing. Then `hover` handles whatever is
    // left, which it reaches by scrolling — that scroll re-renders the feed and
    // makes a third of these calls time out, hence the small budget and the
    // swallowed errors. Measured together they beat either pass alone.
    for (let i = 0; i < PRIME_ATTEMPTS_PER_STEP; i++) {
        const spot = await page.evaluate(findNextTimestampSpot);
        if (spot === null) break;
        await page.mouse.move(spot.x, spot.y);
        moved++;
    }

    const stragglers = await page.evaluate(markUnprimedAnchors);
    for (let i = 0; i < stragglers; i++) {
        try {
            await page.locator(`[data-fbdigest-ts="${i}"]`).hover({ timeout: 1200 });
            moved++;
        } catch {
            // The card was unmounted by the scroll this hover triggered. The
            // post keeps its text, and a later step gets another chance.
        }
    }

    // React rewrites the href in its own tick, so give the last move time to
    // land before the caller reads the DOM.
    if (moved > 0) await sleep(250);
}

/**
 * Runs inside the page. Tags timestamp links that are still unrewritten and
 * off-screen, so Playwright can scroll to each in turn.
 *
 * @returns {number}
 */
function markUnprimedAnchors() {
    for (const stale of document.querySelectorAll("[data-fbdigest-ts]")) {
        stale.removeAttribute("data-fbdigest-ts");
    }

    const feed = document.querySelector('[role="feed"]');
    if (!feed) return 0;

    let tagged = 0;
    const seen = new Set();

    for (const message of document.querySelectorAll('[data-ad-rendering-role="story_message"]')) {
        let card = message;
        while (card && card.parentElement !== feed) card = card.parentElement;
        if (!card || seen.has(card)) continue;
        seen.add(card);

        for (const anchor of card.querySelectorAll("a")) {
            if (!(anchor.getAttribute("href") ?? "").startsWith("?")) continue;
            if (anchor.closest('[aria-label^="Comment by"]')) continue;
            const box = anchor.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            anchor.setAttribute("data-fbdigest-ts", String(tagged));
            tagged++;
            break;
        }
    }

    return tagged;
}

/**
 * Runs inside the page. Returns the on-screen centre of the next timestamp
 * link still waiting to be hovered, or null when none is left.
 *
 * "Waiting" means its href is still the bare tracking query — once Facebook
 * rewrites it to a real permalink the anchor drops out by itself. Anchors that
 * were visited but did not get rewritten are marked so the caller cannot spin
 * on them. Decoys with zero size and comment timestamps are excluded.
 *
 * @returns {{ x: number, y: number } | null}
 */
function findNextTimestampSpot() {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return null;

    const seen = new Set();

    for (const message of document.querySelectorAll('[data-ad-rendering-role="story_message"]')) {
        let card = message;
        while (card && card.parentElement !== feed) card = card.parentElement;
        if (!card || seen.has(card)) continue;
        seen.add(card);

        for (const anchor of card.querySelectorAll("a")) {
            if (!(anchor.getAttribute("href") ?? "").startsWith("?")) continue;
            if (anchor.hasAttribute("data-fbdigest-primed")) continue;
            if (anchor.closest('[aria-label^="Comment by"]')) continue;

            const box = anchor.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;

            // The centre has to be inside the viewport for the mouse to reach
            // it; requiring the whole box was too strict and skipped anchors
            // clipped by a single pixel at the fold.
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            if (y < 1 || y > window.innerHeight - 1) continue;
            if (x < 1 || x > window.innerWidth - 1) continue;

            anchor.setAttribute("data-fbdigest-primed", "1");
            return { x, y };
        }
    }

    return null;
}

/**
 * Runs inside the page. Returns plain data only — no live DOM handles.
 *
 * @returns {Array<object>}
 */
function extractPosts() {
    // Facebook puts role="article" on posts *and* on comments; only comments
    // carry an aria-label, and it names the commenter. That label — not the
    // presence of the role — is what tells the two apart.
    const COMMENT_LABEL = /^(comment by|bình luận của)/i;
    const MESSAGE = '[data-ad-rendering-role="story_message"]';
    const PERSON_LINK = 'a[href*="/user/"], a[href*="profile.php"]';
    const POST_LINK = 'a[href*="/posts/"], a[href*="/permalink/"]';
    /** A real post path, so query-only tracking hrefs are not mistaken for one. */
    const POST_PATH = /\/(posts|permalink)\/\d+/;
    /** "31 July 2026", "31 tháng 7, 2026" — an absolute date, not "15h". */
    const ABSOLUTE_DATE = /\d{1,2}\s+(tháng\s*\d{1,2}|[a-zA-Z]+),?\s+\d{4}/;
    /** "15h", "3 ngày", "2w" — the whole label, as shown on the post header. */
    const RELATIVE_LABEL = /^\d{1,3}\s*(m|h|d|w|phút|giờ|ngày|tuần)$/i;
    /** Joiners injected mid-word to break naive text matching. */
    const ZERO_WIDTH = /[​-‏⁠﻿]/g;

    // Identity capture is opt-out, flagged in from the Node side.
    const collectAuthors = window.__fbdigestAuthors !== false;

    /**
     * Read an element's text in the order it is painted, ignoring anything
     * rendered outside its own box.
     *
     * The post timestamp is split one character per element, shuffled in the
     * DOM, and put back in order by CSS, with extra characters parked outside
     * the link's box as noise. Sorting the text nodes by their laid-out
     * position and keeping only those inside the box recovers what a reader
     * sees, without depending on which CSS trick produced the shuffle.
     */
    const paintedText = (root) => {
        const box = root.getBoundingClientRect();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const parts = [];

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = (node.textContent ?? "").replace(ZERO_WIDTH, "");
            if (text.trim() === "") continue;

            const style = getComputedStyle(node.parentElement);
            if (style.display === "none" || style.visibility === "hidden") continue;
            if (Number(style.opacity) === 0) continue;

            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            if (x < box.left - 1 || x > box.right + 1) continue;
            if (y < box.top - 1 || y > box.bottom + 1) continue;

            parts.push({ x: rect.left, y: rect.top, text });
        }

        parts.sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));
        return parts
            .map((part) => part.text)
            .join("")
            .trim();
    };

    /** Is this node inside a comment rather than the post body? */
    const inComment = (node) => {
        for (
            let el = node.closest('[role="article"]');
            el;
            el = el.parentElement?.closest('[role="article"]') ?? null
        ) {
            if (COMMENT_LABEL.test(el.getAttribute("aria-label") ?? "")) return true;
        }
        return false;
    };

    const feed = document.querySelector('[role="feed"]');
    if (!feed) return [];

    const out = [];
    const seenCards = new Set();

    // Anchored on the message node: it exists for every post with text, and it
    // is the only part of the card free of the decoy "Facebook" spans.
    for (const message of document.querySelectorAll(MESSAGE)) {
        if (inComment(message)) continue;

        // Walk up to the feed's direct child — that element is the post card.
        let card = message;
        while (card && card.parentElement !== feed) card = card.parentElement;
        if (!card || seenCards.has(card)) continue;
        seenCards.add(card);

        // innerText is read from the live node so paragraph breaks survive; a
        // detached clone would flatten them. Mentions inside the body are left
        // intact — cutting them out used to mangle sentences mid-word.
        const text = message.innerText ?? "";

        // Poster identity. The header's profile link is the first one in the
        // card that is not inside a comment; comment authors have the same
        // shape of link, hence the filter.
        const people = collectAuthors
            ? [...card.querySelectorAll(PERSON_LINK)].filter((anchor) => !inComment(anchor))
            : [];

        let authorName = null;
        let authorUrl = null;
        let authorId = null;
        let authorAvatar = null;

        if (people.length > 0) {
            authorUrl = (people[0].getAttribute("href") ?? "").split("?")[0] || null;
            const ids = authorUrl?.match(/\/user\/(\d+)|profile\.php\?id=(\d+)/);
            authorId = ids?.[1] ?? ids?.[2] ?? null;

            authorName =
                people
                    .map((anchor) => anchor.getAttribute("aria-label") ?? paintedText(anchor))
                    .find((value) => typeof value === "string" && value.trim() !== "")
                    ?.trim() ?? null;

            const avatar = people
                .flatMap((anchor) => [...anchor.querySelectorAll("img, image")])
                .find((node) => node.getAttribute("src") || node.getAttribute("xlink:href"));
            authorAvatar =
                avatar?.getAttribute("src") ?? avatar?.getAttribute("xlink:href") ?? null;
        }

        // The post header's timestamp link is the source for both the URL and
        // the date. Its href starts life as a bare "?__cft__[0]=…" tracking
        // query; Facebook rewrites it to the real permalink on a genuine hover,
        // which `primeTimestamps` performs before this runs.
        const header = [...card.querySelectorAll("a")]
            .filter((anchor) => !inComment(anchor))
            .filter((anchor) => {
                const href = anchor.getAttribute("href") ?? "";
                return href.startsWith("?") || POST_PATH.test(href);
            })
            .find((anchor) => {
                const rect = anchor.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });

        let permalink = null;
        let timeLabel = null;

        if (header) {
            const href = header.getAttribute("href") ?? "";
            if (POST_PATH.test(href)) permalink = href.split("?")[0];

            const painted = paintedText(header);
            if (RELATIVE_LABEL.test(painted) || ABSOLUTE_DATE.test(painted)) timeLabel = painted;
        }

        if (permalink === null) {
            // Not hovered, or hover did not take: comment anchors carry the
            // parent post's URL, so they cover posts that already have replies.
            for (const anchor of card.querySelectorAll(POST_LINK)) {
                const path = (anchor.getAttribute("href") ?? "").split("?")[0];
                if (POST_PATH.test(path)) {
                    permalink = path;
                    break;
                }
            }
        }

        out.push({
            index: out.length,
            text,
            permalink,
            timeLabel,
            authorName,
            authorUrl,
            authorId,
            authorAvatar,
        });
    }

    return out;
}

/**
 * @param {{ text: string, permalink: string | null, timeLabel: string | null }} raw
 * @param {{ id?: string, name?: string, url: string }} group
 */
function normalizePost(raw, group) {
    // Zero-width joiners are injected mid-word to defeat text matching; they
    // carry no meaning here and would corrupt both keywords and fingerprints.
    const text = tidy((raw.text ?? "").replace(/[​-‍﻿]/g, "")).replace(TRAILING_EXPAND, "");

    const permalink =
        raw.permalink === null
            ? null
            : raw.permalink.startsWith("http")
              ? raw.permalink
              : `https://www.facebook.com${raw.permalink}`;

    const postedAt = parsePostedAt(raw.timeLabel);

    const absolute = (href) =>
        href === null || href === undefined || href === ""
            ? null
            : href.startsWith("http")
              ? href
              : `https://www.facebook.com${href}`;

    return {
        id: fingerprint({ groupId: group.id ?? group.url, text }),
        authorName: raw.authorName ?? null,
        authorUrl: absolute(raw.authorUrl),
        authorId: raw.authorId ?? null,
        authorAvatar: raw.authorAvatar ?? null,
        groupId: group.id ?? null,
        groupName: group.name ?? group.url,
        groupUrl: group.url,
        text,
        permalink,
        // The absolute label from the permalink anchor; the visible label is
        // relative ("15h") and is never parsed.
        timeLabel: raw.timeLabel,
        postedAt: postedAt === null ? null : postedAt.toISOString(),
        collectedAt: new Date().toISOString(),
    };
}

/**
 * Walk every configured group in sequence.
 *
 * @param {import("playwright").Page} page
 * @param {Array<object>} groups
 * @param {{ seen?: Record<string, string> }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function collectAll(page, groups, options = {}) {
    const delay = envInt("DELAY_BETWEEN_GROUPS_MS", 5000);
    const all = [];

    for (const [index, group] of groups.entries()) {
        const posts = await collectGroup(page, group, options);
        all.push(...posts);

        if (index < groups.length - 1) await sleep(delay);
    }

    return all;
}
