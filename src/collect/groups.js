/**
 * Danh sách nhóm tài khoản đang tham gia.
 *
 * Đọc trang "Nhóm của bạn" (/groups/joins/) và trả về id + tên + url của từng
 * nhóm, đủ để dán thẳng vào "groups" trong config.
 *
 * Hai điểm khác với việc quét feed:
 *
 * 1. Link nhóm nằm rải khắp trang (thanh bên, thẻ gợi ý, breadcrumb…), nên chỉ
 *    nhận anchor có pathname đúng dạng "/groups/<slug>" — bỏ mọi đường dẫn con
 *    (/groups/feed, /groups/<id>/user/…), và bỏ các slug hệ thống.
 *
 * 2. Danh sách cũng cuộn lười như feed: nhóm nằm dưới chỉ được render khi cuộn
 *    tới, nên phải gom sau mỗi bước cuộn thay vì đọc một lần ở cuối.
 *
 * Nhóm có đường dẫn chữ ("/groups/vieclamit") không mang id số. Với những nhóm
 * đó, tool mở trang nhóm và đọc id số trong HTML — xem `resolveGroupId`.
 */

import { envInt } from "../config.js";
import { log, sleep } from "../logger.js";
import { assertNotCheckpointed } from "./browser.js";

/** Trang liệt kê nhóm đã tham gia, và trang dự phòng nếu nó trống. */
const JOINED_URLS = [
    "https://www.facebook.com/groups/joins/",
    "https://www.facebook.com/groups/feed/",
];

/** Dừng cuộn sau ngần này lần cuộn liên tiếp không thấy nhóm mới. */
const BARREN_SCROLL_LIMIT = 4;

/** Mỗi bước cuộn đi bao xa. */
const SCROLL_STEP_PX = 900;

/** Chờ nhóm mới render xong sau mỗi bước cuộn. */
const SCROLL_SETTLE_MS = 900;

/**
 * Tách slug nhóm từ một URL Facebook.
 *
 * Chỉ chấp nhận đường dẫn gốc của nhóm; "/groups/feed/", "/groups/123/user/9"
 * hay "/watch" đều trả về null.
 *
 * @param {string} url
 * @returns {string | null}
 */
export function groupSlug(url) {
    let path;
    try {
        path = new URL(url, "https://www.facebook.com").pathname;
    } catch {
        return null;
    }

    const match = path.match(/^\/groups\/([^/]+)\/?$/);
    if (match === null) return null;

    const slug = decodeURIComponent(match[1]);
    return RESERVED_SLUGS.has(slug.toLowerCase()) ? null : slug;
}

/** Đường dẫn "/groups/<x>" của Facebook mà <x> không phải là một nhóm. */
const RESERVED_SLUGS = new Set([
    "feed",
    "joins",
    "discover",
    "create",
    "search",
    "browse",
    "invites",
    "notifications",
    "categories",
    "your_groups",
    "member_requests",
]);

/**
 * Gộp các lần nhìn thấy một nhóm thành một mục duy nhất.
 *
 * Cùng một nhóm xuất hiện nhiều lần trên trang: có anchor chỉ bọc ảnh đại diện
 * nên không có tên, có anchor kèm cả số thành viên. Gộp theo slug và giữ tên
 * dài nhất đọc được, thay vì để lần gặp cuối ghi đè lần trước.
 *
 * @param {Array<{ slug: string, name: string }>} seenGroups
 * @returns {Array<{ id: string, name: string, url: string }>}
 */
export function mergeSightings(seenGroups) {
    /** @type {Map<string, { id: string, name: string, url: string }>} */
    const bySlug = new Map();

    for (const { slug, name } of seenGroups) {
        if (typeof slug !== "string" || slug === "") continue;
        const existing = bySlug.get(slug);
        const cleaned = typeof name === "string" ? name.trim() : "";

        if (existing === undefined) {
            bySlug.set(slug, {
                id: slug,
                name: cleaned,
                url: `https://www.facebook.com/groups/${slug}`,
            });
            continue;
        }
        if (cleaned.length > existing.name.length) existing.name = cleaned;
    }

    return [...bySlug.values()];
}

/**
 * Mở trang "Nhóm của bạn" và trả về các nhóm tài khoản đang tham gia.
 *
 * @param {import("playwright").Page} page
 * @param {{ resolveIds?: boolean }} [options]
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>}
 */
export async function listJoinedGroups(page, options = {}) {
    const maxScrolls = envInt("SCROLLS_PER_GROUP_LIST", 60);
    const resolveIds = options.resolveIds ?? true;

    for (const url of JOINED_URLS) {
        const groups = await walkGroupList(page, url, maxScrolls);
        if (groups.length === 0) {
            log.warn(`${url} không liệt kê nhóm nào — thử trang khác.`);
            continue;
        }

        if (resolveIds) await resolveSlugIds(page, groups);
        return groups;
    }

    return [];
}

/**
 * Cuộn hết một trang danh sách và gom link nhóm sau mỗi bước.
 *
 * @param {import("playwright").Page} page
 * @param {string} url
 * @param {number} maxScrolls
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>}
 */
async function walkGroupList(page, url, maxScrolls) {
    log.step(`Đọc danh sách nhóm: ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    assertNotCheckpointed(page);
    await sleep(SCROLL_SETTLE_MS);

    /** @type {Array<{ slug: string, name: string }>} */
    const sightings = [];
    let groups = [];
    let barrenScrolls = 0;

    for (let step = 0; step < maxScrolls; step++) {
        sightings.push(...(await page.evaluate(extractGroupLinks)));

        const before = groups.length;
        groups = mergeSightings(sightings);
        log.debug(`bước ${step}: ${groups.length} nhóm`);

        barrenScrolls = groups.length === before ? barrenScrolls + 1 : 0;
        if (barrenScrolls >= BARREN_SCROLL_LIMIT) break;

        await page.mouse.wheel(0, SCROLL_STEP_PX);
        await sleep(SCROLL_SETTLE_MS);
        assertNotCheckpointed(page);
    }

    return groups;
}

/**
 * Thay slug chữ bằng id số, bằng cách mở từng trang nhóm.
 *
 * Chỉ chạy cho nhóm có đường dẫn chữ: nhóm nào đường dẫn đã là số thì id nằm
 * sẵn trong URL, không phải tải thêm trang nào.
 *
 * @param {import("playwright").Page} page
 * @param {Array<{ id: string, name: string, url: string }>} groups Sửa tại chỗ.
 */
async function resolveSlugIds(page, groups) {
    const pending = groups.filter((group) => !/^\d+$/.test(group.id));
    if (pending.length === 0) return;

    log.step(`${pending.length} nhóm dùng đường dẫn chữ — mở từng nhóm để lấy id số…`);

    for (const group of pending) {
        const id = await resolveGroupId(page, group.url);
        if (id === null) {
            // Slug vẫn dùng được: nó là khoá khử trùng lặp, và url mới là thứ
            // bước collect thực sự mở.
            log.warn(`Không đọc được id số của ${group.url} — giữ nguyên "${group.id}".`);
            continue;
        }
        group.id = id;
    }
}

/** Các chỗ Facebook nhúng id số của nhóm trong HTML trang nhóm. */
const GROUP_ID_PATTERNS = [
    /"groupID"\s*:\s*"(\d+)"/,
    /"group_id"\s*:\s*"?(\d+)"?/,
    /fb:\/\/group\/(\d+)/,
];

/**
 * Đọc id số của một nhóm từ HTML trang nhóm.
 *
 * @param {import("playwright").Page} page
 * @param {string} url
 * @returns {Promise<string | null>}
 */
export async function resolveGroupId(page, url) {
    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        assertNotCheckpointed(page);
    } catch (error) {
        log.warn(`Mở ${url} thất bại: ${error.message}`);
        return null;
    }

    // Trang nhóm có thể chuyển hướng sang dạng /groups/<id>, khi đó id nằm ngay
    // trên URL và không cần tìm trong HTML.
    const redirected = groupSlug(page.url());
    if (redirected !== null && /^\d+$/.test(redirected)) return redirected;

    const html = await page.content();
    for (const pattern of GROUP_ID_PATTERNS) {
        const match = html.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Chạy trong trang. Trả về mọi link trỏ tới trang gốc của một nhóm.
 *
 * @returns {Array<{ slug: string, name: string }>}
 */
function extractGroupLinks() {
    const RESERVED = new Set([
        "feed",
        "joins",
        "discover",
        "create",
        "search",
        "browse",
        "invites",
        "notifications",
        "categories",
        "your_groups",
        "member_requests",
    ]);
    // Ký tự vô hình Facebook chèn giữa chữ để phá việc so khớp text. Tách làm
    // hai lượt: một character class trộn dấu kết hợp (U+034F) với ký tự thường
    // là lỗi lint, và đúng là như vậy.
    const stripInvisible = (text) =>
        text.replace(/[\u200b-\u200f\u2060\ufeff]/gu, "").replace(/\u034f/gu, "");

    const found = [];

    for (const anchor of document.querySelectorAll('a[href*="/groups/"]')) {
        let path;
        try {
            path = new URL(anchor.href, location.origin).pathname;
        } catch {
            continue;
        }

        const match = path.match(/^\/groups\/([^/]+)\/?$/);
        if (match === null) continue;

        const slug = decodeURIComponent(match[1]);
        if (RESERVED.has(slug.toLowerCase())) continue;

        // Anchor của một hàng chứa cả tên nhóm lẫn dòng phụ ("12K thành viên",
        // "5 bài viết mới"); tên là dòng đầu.
        const text = stripInvisible(anchor.innerText ?? anchor.textContent ?? "");
        const name = text.split("\n")[0].trim();

        found.push({ slug, name });
    }

    return found;
}

/**
 * Trộn danh sách nhóm quét được vào mảng "groups" đang có trong config.
 *
 * Mục cũ được giữ nguyên — người dùng có thể đã sửa tên hoặc thêm khoá riêng —
 * và chỉ nhóm chưa có mới được thêm vào cuối. Nhận diện trùng bằng cả id lẫn
 * url, vì cùng một nhóm có thể đã được ghi bằng đường dẫn chữ trong khi lần
 * quét này trả về id số.
 *
 * @param {Array<object>} existing Mảng "groups" hiện có trong config.
 * @param {Array<{ id: string, name: string, url: string }>} found
 * @returns {{ groups: Array<object>, added: Array<object> }}
 */
export function mergeConfigGroups(existing, found) {
    const known = new Set();
    for (const group of existing) {
        if (typeof group?.id === "string") known.add(group.id);
        const slug = typeof group?.url === "string" ? groupSlug(group.url) : null;
        if (slug !== null) known.add(slug);
    }

    const added = found.filter((group) => {
        const slug = groupSlug(group.url);
        return !known.has(group.id) && (slug === null || !known.has(slug));
    });

    return { groups: [...existing, ...added], added };
}
