/**
 * Playwright browser lifecycle.
 *
 * Every run reuses one fixed Chromium profile directory (FB_USER_DATA_DIR), the
 * same way a normal browser profile works: cookies, localStorage and refreshed
 * session tokens are written back to disk when the run ends, so you sign in by
 * hand once and later runs just open the profile.
 *
 * Deliberately plain otherwise: the default Chromium build, the default user
 * agent, no proxy, no fingerprint patching. The tool drives a browser as
 * itself. If Facebook's automation detection objects to that, the answer is to
 * stop running it, not to disguise it.
 */

import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { env, envBool } from "../config.js";

/** Facebook URL fragments that mean "the account needs human attention". */
const CHECKPOINT_MARKERS = ["/checkpoint", "/login", "/recover", "two_step_verification"];

/** Where the fixed browser profile lives. */
export function profileDir() {
    return resolve(env("FB_USER_DATA_DIR", "./.fb-profile"));
}

/**
 * Launch Chromium on the fixed profile.
 *
 * Shared by `login` and `collect` so both stages always touch the same profile.
 *
 * Note: Playwright does not refuse a second launch on the same directory, so
 * two runs at once share one profile and the last one to exit wins. Do not run
 * `login` while a scheduled `collect` is in flight.
 *
 * @param {{ headless?: boolean }} [options]
 * @returns {Promise<import("playwright").BrowserContext>}
 */
export async function launchProfile({ headless = envBool("HEADLESS", false) } = {}) {
    return await chromium.launchPersistentContext(profileDir(), {
        headless,
        locale: "vi-VN",
        viewport: { width: 1280, height: 900 },
    });
}

/**
 * Open the fixed profile and hand back the tab to work in.
 *
 * The profile keeps exactly one tab: the persistent context always restores at
 * least one page, and that page is reused instead of opening a new one.
 *
 * @returns {Promise<{ context: import("playwright").BrowserContext,
 *                     page: import("playwright").Page }>}
 */
export async function openSession() {
    const dir = profileDir();

    try {
        await access(dir);
    } catch {
        throw new Error(
            `Chưa có profile trình duyệt (${dir}).\n` + `Chạy "npm run login" một lần trước.`,
        );
    }

    const context = await launchProfile();
    const page = context.pages()[0] ?? (await context.newPage());

    return { context, page };
}

/**
 * Throw if the page has been redirected to a checkpoint or back to login.
 *
 * The script stops here on purpose. It does not attempt to solve, bypass, or
 * wait out a checkpoint — that is the account owner's job, in a real browser.
 *
 * @param {import("playwright").Page} page
 */
export function assertNotCheckpointed(page) {
    const url = page.url();
    if (CHECKPOINT_MARKERS.some((marker) => url.includes(marker))) {
        throw new Error(
            `Facebook chuyển hướng sang ${url}\n` +
                `Tài khoản đang bị checkpoint hoặc session hết hạn. ` +
                `Chạy "npm run login" để đăng nhập lại trong chính profile này.`,
        );
    }
}

/**
 * Close the context — this is what flushes the refreshed cookies to the
 * profile directory, so it must run even when the collect step failed.
 *
 * @param {{ context?: import("playwright").BrowserContext }} session
 */
export async function closeSession(session) {
    await session.context?.close();
}
