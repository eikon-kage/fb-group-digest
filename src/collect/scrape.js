/**
 * Group feed collection.
 *
 * Scope note: this reads the text of posts that are already visible to the
 * signed-in account, plus each post's own permalink. It deliberately does not
 * collect poster identities — no profile URLs, no user ids, no author names.
 * The output feeds a keyword/AI digest, not an outreach list.
 */

import { envInt } from "../config.js";
import { fingerprint, tidy } from "../filter/normalize.js";
import { log, sleep } from "../logger.js";
import { assertNotCheckpointed } from "./browser.js";

/** Labels Facebook uses on the "show the rest of this post" control. */
const EXPAND_LABELS = ["Xem thêm", "See more", "Xem thêm…"];

/**
 * Walk one group's feed and return its posts.
 *
 * @param {import("playwright").Page} page
 * @param {{ id?: string, name?: string, url: string }} group
 * @returns {Promise<Array<object>>}
 */
export async function collectGroup(page, group) {
    const scrolls = envInt("SCROLLS_PER_GROUP", 8);
    const maxPosts = envInt("MAX_POSTS_PER_GROUP", 60);

    log.step(`Nhóm: ${group.name ?? group.url}`);

    await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    assertNotCheckpointed(page);

    try {
        await page.waitForSelector('[role="article"]', { timeout: 20_000 });
    } catch {
        log.warn("Không thấy bài đăng nào — nhóm có thể trống, hoặc bạn chưa được duyệt vào nhóm.");
        return [];
    }

    for (let i = 0; i < scrolls; i++) {
        await expandTruncatedPosts(page);
        await page.mouse.wheel(0, 2200);
        // A fixed pause between scrolls: it keeps request volume low and gives
        // the feed time to render. It is not randomized to look human.
        await sleep(1500);
        assertNotCheckpointed(page);

        const count = await page.locator('[role="article"]').count();
        if (count >= maxPosts) break;
    }

    await expandTruncatedPosts(page);

    const raw = await page.evaluate(extractPosts);
    const posts = raw
        .map((post) => normalizePost(post, group))
        .filter((post) => post.text.length >= 20)
        .slice(0, maxPosts);

    log.info(`Lấy được ${posts.length} bài.`);
    return posts;
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
 * Runs inside the page. Returns plain data only — no live DOM handles.
 *
 * @returns {Array<{ text: string, permalink: string | null, timeLabel: string | null }>}
 */
function extractPosts() {
    const articles = [...document.querySelectorAll('[role="article"]')];

    return articles.map((article) => {
        // The permalink is the only link we keep. Profile links (/user/,
        // profile.php, and bare /name vanity URLs) are explicitly skipped.
        let permalink = null;
        for (const anchor of article.querySelectorAll("a[href]")) {
            const href = anchor.getAttribute("href") ?? "";
            if (href.includes("/posts/") || href.includes("/permalink/")) {
                permalink = href.split("?")[0];
                break;
            }
        }

        let timeLabel = null;
        const timeAnchor = article.querySelector("a[aria-label], abbr[aria-label]");
        if (timeAnchor) timeLabel = timeAnchor.getAttribute("aria-label");

        return {
            text: article.innerText ?? "",
            permalink,
            timeLabel,
        };
    });
}

/**
 * @param {{ text: string, permalink: string | null, timeLabel: string | null }} raw
 * @param {{ id?: string, name?: string, url: string }} group
 */
function normalizePost(raw, group) {
    const text = tidy(raw.text);
    const permalink =
        raw.permalink === null
            ? null
            : raw.permalink.startsWith("http")
              ? raw.permalink
              : `https://www.facebook.com${raw.permalink}`;

    return {
        id: fingerprint({ groupId: group.id ?? group.url, text }),
        groupId: group.id ?? null,
        groupName: group.name ?? group.url,
        groupUrl: group.url,
        text,
        permalink,
        // Facebook renders a relative label ("2 giờ"), not an absolute date.
        // Kept verbatim; `collectedAt` is the reliable timestamp.
        timeLabel: raw.timeLabel,
        collectedAt: new Date().toISOString(),
    };
}

/**
 * Walk every configured group in sequence.
 *
 * @param {import("playwright").Page} page
 * @param {Array<object>} groups
 * @returns {Promise<Array<object>>}
 */
export async function collectAll(page, groups) {
    const delay = envInt("DELAY_BETWEEN_GROUPS_MS", 5000);
    const all = [];

    for (const [index, group] of groups.entries()) {
        const posts = await collectGroup(page, group);
        all.push(...posts);

        if (index < groups.length - 1) await sleep(delay);
    }

    return all;
}
