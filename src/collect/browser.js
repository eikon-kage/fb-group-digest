/**
 * Playwright browser lifecycle.
 *
 * Deliberately plain: the default Chromium build, the default user agent, no
 * proxy, no fingerprint patching. The tool drives a browser as itself. If
 * Facebook's automation detection objects to that, the answer is to stop
 * running it, not to disguise it.
 */

import { access } from "node:fs/promises";
import { chromium } from "playwright";
import { env, envBool } from "../config.js";

/** Facebook URL fragments that mean "the account needs human attention". */
const CHECKPOINT_MARKERS = ["/checkpoint", "/login", "/recover", "two_step_verification"];

/**
 * Open a browser context restored from the saved login session.
 *
 * @returns {Promise<{ browser: import("playwright").Browser,
 *                     context: import("playwright").BrowserContext,
 *                     page: import("playwright").Page }>}
 */
export async function openSession() {
    const statePath = env("FB_STORAGE_STATE", "./storage-state.json");

    try {
        await access(statePath);
    } catch {
        throw new Error(
            `Chưa có session đăng nhập (${statePath}).\n` + `Chạy "npm run login" trước.`,
        );
    }

    const browser = await chromium.launch({ headless: envBool("HEADLESS", false) });
    const context = await browser.newContext({
        storageState: statePath,
        locale: "vi-VN",
        viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    return { browser, context, page };
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
                `Mở Facebook bằng trình duyệt thường, xử lý xong rồi chạy lại "npm run login".`,
        );
    }
}

/**
 * @param {{ browser: import("playwright").Browser }} session
 */
export async function closeSession(session) {
    await session.browser?.close();
}
