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
 * 4. A post's own metadata is withheld until touched. Its permalink anchor
 *    starts as a bare tracking query and is rewritten to the real URL only on a
 *    genuine hover, which `primeTimestamps` performs.
 *
 * 5. The timestamp comes in two renderings, and both are read here. Most cards
 *    split it one character per element, shuffle them, and put them back in
 *    visual order with CSS — `paintedText` reads that back by laid-out
 *    position. The rest hand the label to an SVG sprite: the link holds only
 *    `<use xlink:href="#SvgT1">` and the words sit in a `<text>` element
 *    elsewhere in the document, so the link itself reads as empty. Handling
 *    only the first form left 1 post in 20 with a date.
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

/** How far one step of the walk advances the feed. */
const SCROLL_STEP_PX = 1600;

/**
 * The wheel moves in hops this size, with a hover pass between them.
 *
 * It has to stay under the 900px viewport: a timestamp link is blank until the
 * mouse touches it, and the mouse can only reach what is on screen. Hopping
 * 1600px at once left a ~700px band that was below the fold on one step and
 * above it on the next, so every post in that band came back with no date —
 * measured on a live group, 10 of 11 posts.
 */
const SCROLL_HOP_PX = 700;

/** How long to wait before re-reading a window for the timestamps it lacked. */
const TIMESTAMP_SETTLE_MS = 1500;

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
 * The walk stops at whichever comes first: `MAX_POSTS_PER_GROUP` posts, the
 * bottom of the window reaching posts an earlier run already reported (see
 * `atSeenBoundary` — this is the one that makes a second run cheap),
 * `BARREN_SCROLL_LIMIT` scrolls that yield nothing, or `SCROLLS_PER_GROUP`.
 *
 * There is no cutoff by post age, deliberately. A post's timestamp is usually
 * readable now, but not always, and it is only accurate to the hour — "stop at
 * N days back" would stop on the first post whose date could not be read.
 *
 * @param {import("playwright").Page} page
 * @param {{ id?: string, name?: string, url: string }} group
 * @param {{ seen?: Record<string, string> }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function collectGroup(page, group, options = {}) {
    const maxScrolls = envInt("SCROLLS_PER_GROUP", 120);
    const maxPosts = envInt("MAX_POSTS_PER_GROUP", 60);
    // How deep a run of already-reported posts at the *bottom* of the window
    // has to get before the walk is called finished. See `mergeWindow`.
    const seenStopStreak = envInt("STOP_AFTER_SEEN", 5);
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
        const stamps = await page.evaluate(countTimestampAnchors);

        const before = collected.size;
        // Not named `window`: page-context helpers in this file mean the
        // browser global by that name, and one of the two should stay obvious.
        const context = { group, seen, collected, alreadySeen };
        const raw = await page.evaluate(extractPosts);
        let merged = mergeWindow(raw, context);

        // A freshly rendered card carries an empty timestamp link; Facebook
        // fills in the real one a beat later. Reading the window a second time
        // costs one sleep per step and is the difference between most posts
        // carrying a date and almost none of them — measured on a live group,
        // 1 of 20 posts before, most of them after. `mergeWindow` backfills, so
        // the second read only adds what the first one missed.
        if (raw.some((post) => post.timeLabel === null)) {
            await sleep(TIMESTAMP_SETTLE_MS);
            merged = mergeWindow(await page.evaluate(extractPosts), context);
        }

        // Priming is the fragile half of the scrape: an unhovered timestamp
        // link carries no text at all, so a step where `trống` stays high is
        // the reason a batch of posts came back with no date.
        log.debug(
            `bước ${step}: ${raw.length} bài trong khung, ` +
                `${raw.filter((post) => post.timeLabel !== null).length} có nhãn giờ, ` +
                `link giờ: ${stamps.filled} đã hiện / ${stamps.blank} còn trống`,
        );

        // The feed is chronological, so the run walks back through it until the
        // post cap is hit, the bottom of the window lands in already-reported
        // territory, or the feed stops yielding anything at all.
        if (collected.size >= maxPosts) break;
        if (atSeenBoundary(merged, { streak: seenStopStreak, scrolled: step > 0 })) {
            log.info(`Chạm ${merged.tailSeen} bài liên tiếp đã lấy lần trước — hết bài mới.`);
            break;
        }
        barrenScrolls = collected.size === before ? barrenScrolls + 1 : 0;
        if (barrenScrolls >= BARREN_SCROLL_LIMIT) break;

        // Not randomized to look human — the hop size is what makes every
        // timestamp link pass through the visible area at least once.
        for (let moved = 0; moved < SCROLL_STEP_PX; moved += SCROLL_HOP_PX) {
            await page.mouse.wheel(0, Math.min(SCROLL_HOP_PX, SCROLL_STEP_PX - moved));
            await sleep(600);
            // Cheap pass only: the mouse visits what is now on screen. The
            // expensive straggler hovers stay at the top of the next step.
            await primeVisible(page);
        }
        await sleep(600);
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
 * Merge one window of extracted posts into the run's accumulator.
 *
 * The return value describes where the window sits relative to the posts an
 * earlier run already reported. `tailSeen` is the run of already-reported posts
 * at the *bottom* of the window — counted from the end, so it resets on the
 * last unreported post rather than on the first.
 *
 * That direction is the whole point. Pinned posts sit above the chronological
 * run and are reported on the first run, so a plain count of already-seen posts
 * treats a pinned post as evidence that the walk is finished. Counting from the
 * bottom ignores anything above the newest unreported post, which is exactly
 * what "have we walked past the new posts yet" means in a chronological feed.
 *
 * Posts too short to be worth reporting are dropped without counting either
 * way: they are neither news nor evidence that the news has run out.
 *
 * @param {Array<object>} rawPosts In feed order, newest first.
 * @param {{
 *   group: { id?: string, name?: string, url: string },
 *   seen: Record<string, string>,
 *   collected: Map<string, object>,
 *   alreadySeen: Set<string>,
 * }} context `collected` and `alreadySeen` are mutated.
 * @returns {{ eligible: number, tailSeen: number }}
 */
export function mergeWindow(rawPosts, context) {
    const { group, seen, collected, alreadySeen } = context;
    let eligible = 0;
    let tailSeen = 0;

    for (const raw of rawPosts) {
        const post = normalizePost(raw, group);
        if (post.text.length < 20) continue;
        eligible++;

        if (isSeen(seen, post)) {
            for (const key of seenKeys(post)) alreadySeen.add(key);
            tailSeen++;
            continue;
        }

        // Unreported — so whatever run of old posts was building above it does
        // not reach the bottom of the window, and the walk is not finished.
        tailSeen = 0;

        // A post first seen before its timestamp was hovered arrives with no
        // link and no date. Later steps get another chance at both, so an
        // existing entry is upgraded rather than skipped.
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

    return { eligible, tailSeen };
}

/**
 * Has the walk reached the posts an earlier run already reported?
 *
 * Two ways to decide yes, because one alone leaves a gap:
 *
 * - A deep enough run of old posts at the bottom of the window. The margin is
 *   there for the odd card that turns up out of chronological order.
 * - Nothing in the window is new at all. A group whose entire history is
 *   shorter than that margin can never build the run, and without this it would
 *   be walked to the end of the feed on every run. Only after a scroll: the
 *   first window can be a single card that has not finished loading, and one
 *   old card is not evidence of anything.
 *
 * @param {{ eligible: number, tailSeen: number }} window
 * @param {{ streak: number, scrolled: boolean }} options
 * @returns {boolean}
 */
export function atSeenBoundary(window, options) {
    if (options.streak <= 0) return false;
    if (window.tailSeen === 0) return false;
    if (window.tailSeen >= options.streak) return true;
    return options.scrolled && window.tailSeen === window.eligible;
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
 * Hover every unprimed timestamp link currently on screen.
 *
 * This is the whole reason the walk scrolls in small hops: an unhovered link
 * has no text at all — Facebook fills in both the label and the real href on
 * the first genuine mouse-over — so a post the mouse never reached has no date.
 *
 * @param {import("playwright").Page} page
 * @returns {Promise<number>} how many anchors were touched
 */
async function primeVisible(page) {
    let moved = 0;

    for (let i = 0; i < PRIME_ATTEMPTS_PER_STEP; i++) {
        const spot = await page.evaluate(findNextTimestampSpot);
        if (spot === null) break;
        await page.mouse.move(spot.x, spot.y);
        moved++;
    }

    // React rewrites the href in its own tick; without this the very next
    // extract reads the anchor before it has been filled in.
    if (moved > 0) await sleep(200);
    return moved;
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
    // Two passes, in order of cost. First the mouse visits anchors already on
    // screen: cheap, and it disturbs nothing. Then `hover` handles whatever is
    // left, which it reaches by scrolling — that scroll re-renders the feed and
    // makes a third of these calls time out, hence the small budget and the
    // swallowed errors. Measured together they beat either pass alone.
    let moved = await primeVisible(page);

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
 * Runs inside the page. Tags timestamp links that are still blank and
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

    /**
     * Can a timestamp be read off this link without touching it?
     *
     * Two renderings have to be checked. Most cards paint the characters as
     * text nodes; some hand the whole label to an SVG sprite, where the text
     * lives in a <text> element elsewhere in the document and the link itself
     * is empty. Only a link with neither is worth a hover.
     */
    const hasStamp = (anchor) => {
        // The joiners are stripped one class at a time: a range that mixes a
        // combining mark in with the rest is a lint error, and rightly so.
        const visible = (anchor.textContent ?? "")
            .replace(/[\u200b-\u200f\u2060\ufeff]/gu, "")
            .replace(/\u034f/gu, "")
            .trim();
        if (visible !== "") return true;
        for (const use of anchor.querySelectorAll("use")) {
            const id = (use.getAttribute("xlink:href") ?? use.getAttribute("href") ?? "").slice(1);
            if (id && (document.getElementById(id)?.textContent ?? "").trim() !== "") return true;
        }
        return false;
    };

    const isHeaderLink = (anchor) => {
        const href = anchor.getAttribute("href") ?? "";
        if (!(href.startsWith("?") || /\/(posts|permalink)\/\d+/.test(href))) return false;
        return !anchor.closest('[aria-label^="Comment by"], [aria-label^="Bình luận của"]');
    };

    /**
     * A hover is worth its cost while either half is still missing: an href
     * that is still the bare "?__cft__" tracking query has no permalink in it
     * yet, and a link with no stamp has no date. Skipping the first half cost
     * two thirds of the permalinks in a measured run.
     */
    const needsWaking = (anchor) =>
        isHeaderLink(anchor) &&
        ((anchor.getAttribute("href") ?? "").startsWith("?") || !hasStamp(anchor));

    let tagged = 0;
    const seen = new Set();

    for (const message of document.querySelectorAll('[data-ad-rendering-role="story_message"]')) {
        let card = message;
        while (card && card.parentElement !== feed) card = card.parentElement;
        if (!card || seen.has(card)) continue;
        seen.add(card);

        for (const anchor of card.querySelectorAll("a")) {
            if (!needsWaking(anchor)) continue;
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

    /**
     * Can a timestamp be read off this link without touching it?
     *
     * Two renderings have to be checked. Most cards paint the characters as
     * text nodes; some hand the whole label to an SVG sprite, where the text
     * lives in a <text> element elsewhere in the document and the link itself
     * is empty. Only a link with neither is worth a hover.
     */
    const hasStamp = (anchor) => {
        // The joiners are stripped one class at a time: a range that mixes a
        // combining mark in with the rest is a lint error, and rightly so.
        const visible = (anchor.textContent ?? "")
            .replace(/[\u200b-\u200f\u2060\ufeff]/gu, "")
            .replace(/\u034f/gu, "")
            .trim();
        if (visible !== "") return true;
        for (const use of anchor.querySelectorAll("use")) {
            const id = (use.getAttribute("xlink:href") ?? use.getAttribute("href") ?? "").slice(1);
            if (id && (document.getElementById(id)?.textContent ?? "").trim() !== "") return true;
        }
        return false;
    };

    const isHeaderLink = (anchor) => {
        const href = anchor.getAttribute("href") ?? "";
        if (!(href.startsWith("?") || /\/(posts|permalink)\/\d+/.test(href))) return false;
        return !anchor.closest('[aria-label^="Comment by"], [aria-label^="Bình luận của"]');
    };

    /**
     * A hover is worth its cost while either half is still missing: an href
     * that is still the bare "?__cft__" tracking query has no permalink in it
     * yet, and a link with no stamp has no date. Skipping the first half cost
     * two thirds of the permalinks in a measured run.
     */
    const needsWaking = (anchor) =>
        isHeaderLink(anchor) &&
        ((anchor.getAttribute("href") ?? "").startsWith("?") || !hasStamp(anchor));

    const seen = new Set();

    for (const message of document.querySelectorAll('[data-ad-rendering-role="story_message"]')) {
        let card = message;
        while (card && card.parentElement !== feed) card = card.parentElement;
        if (!card || seen.has(card)) continue;
        seen.add(card);

        for (const anchor of card.querySelectorAll("a")) {
            if (!needsWaking(anchor)) continue;
            // Two attempts: the first mouse-over sometimes lands while React is
            // re-rendering the card and does nothing. A link that woke up has
            // text, so it stops being a candidate above.
            if (Number(anchor.getAttribute("data-fbdigest-primed") ?? 0) >= 2) continue;

            const box = anchor.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;

            // The centre has to be inside the viewport for the mouse to reach
            // it; requiring the whole box was too strict and skipped anchors
            // clipped by a single pixel at the fold.
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            if (y < 1 || y > window.innerHeight - 1) continue;
            if (x < 1 || x > window.innerWidth - 1) continue;

            const tries = Number(anchor.getAttribute("data-fbdigest-primed") ?? 0);
            anchor.setAttribute("data-fbdigest-primed", String(tries + 1));
            return { x, y };
        }
    }

    return null;
}

/**
 * Runs inside the page. How many timestamp links have been woken up.
 *
 * A link Facebook has filled in points at the post; one still waiting carries
 * only the "?__cft__" tracking query and renders empty.
 *
 * @returns {{ filled: number, blank: number }}
 */
function countTimestampAnchors() {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return { filled: 0, blank: 0 };

    let filled = 0;
    let blank = 0;

    for (const anchor of feed.querySelectorAll("a")) {
        const href = anchor.getAttribute("href") ?? "";
        const box = anchor.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (href.startsWith("?")) blank++;
        else if (/\/(posts|permalink)\/\d+/.test(href) && (anchor.textContent ?? "") !== "")
            filled++;
    }

    return { filled, blank };
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
    /** "31 July 2026", "31 Tháng 7, 2026" — an absolute date, not "15h". */
    const ABSOLUTE_DATE = /\d{1,2}\s+(tháng\s*\d{1,2}|[a-zA-Z]+),?\s+\d{4}/i;
    /**
     * "15h", "3 ngày", "2w", "34 minutes ago" — the whole label, as shown on
     * the post header. The sprite form spells the unit out and adds "ago".
     */
    const RELATIVE_LABEL =
        /^\d{1,3}\s*(m|h|d|w|mins?|minutes?|hrs?|hours?|days?|weeks?|phút|giờ|ngày|tuần)(\s+(ago|trước))?$/i;
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

    /**
     * The timestamp as the reader sees it, whichever trick this card used.
     *
     * Most cards paint the characters as text nodes, shuffled, which
     * `paintedText` puts back in order. Some hand the whole label to an SVG
     * sprite instead — the link holds only `<use xlink:href="#SvgT1">` and the
     * words live in a `<text id="SvgT1">34 minutes ago</text>` elsewhere in the
     * document. That second form is why a run could come back with one date in
     * twenty: there is no text on the link to read at all.
     *
     * @param {Element} anchor
     * @returns {string}
     */
    const stampText = (anchor) => {
        const painted = paintedText(anchor);
        if (painted !== "") return painted;

        for (const use of anchor.querySelectorAll("use")) {
            const id = (use.getAttribute("xlink:href") ?? use.getAttribute("href") ?? "").slice(1);
            const text = id ? (document.getElementById(id)?.textContent ?? "").trim() : "";
            if (text !== "") return text;
        }

        return "";
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
        const headers = [...card.querySelectorAll("a")]
            .filter((anchor) => !inComment(anchor))
            .filter((anchor) => {
                const href = anchor.getAttribute("href") ?? "";
                return href.startsWith("?") || POST_PATH.test(href);
            })
            .filter((anchor) => {
                const rect = anchor.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });

        let permalink = null;
        let timeLabel = null;

        for (const anchor of headers) {
            const href = anchor.getAttribute("href") ?? "";
            if (permalink === null && POST_PATH.test(href)) permalink = href.split("?")[0];

            if (timeLabel !== null) continue;

            // Not aria-label: the only anchors carrying an exact date in their
            // label are comment timestamps, and a comment's time is not the
            // post's — using it dated posts hours or days too late.
            const stamp = stampText(anchor);
            if (RELATIVE_LABEL.test(stamp) || ABSOLUTE_DATE.test(stamp)) timeLabel = stamp;
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
