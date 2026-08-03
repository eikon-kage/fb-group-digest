/**
 * One-time interactive login.
 *
 * Opens the fixed browser profile in a visible window and waits for you to sign
 * in by hand — including any 2FA or checkpoint step. Nothing is automated here
 * and no credentials are read from config; the login simply stays in the
 * profile directory, so later runs open an already signed-in browser.
 */

import { log } from "../logger.js";
import { launchProfile, profileDir } from "./browser.js";

const LOGGED_IN_TIMEOUT_MS = 5 * 60 * 1000;

/** Only renders for a signed-in session, across Facebook's layout variants. */
const LOGGED_IN_SELECTOR = '[role="navigation"], [aria-label="Trang chủ"], [aria-label="Home"]';

export async function runLogin() {
    const dir = profileDir();

    // Always visible: the whole point of this command is that a human logs in.
    const context = await launchProfile({ headless: false });
    const page = context.pages()[0] ?? (await context.newPage());

    try {
        log.info(`Mở Facebook bằng profile ${dir}`);
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });

        if (await page.locator(LOGGED_IN_SELECTOR).first().isVisible()) {
            log.info("Profile này đã đăng nhập sẵn — không cần làm gì thêm.");
            return;
        }

        log.info("Đăng nhập bằng tay trong cửa sổ vừa hiện ra (tối đa 5 phút)…");
        try {
            await page.waitForSelector(LOGGED_IN_SELECTOR, { timeout: LOGGED_IN_TIMEOUT_MS });
        } catch {
            throw new Error("Hết thời gian chờ đăng nhập. Chạy lại `npm run login`.");
        }

        log.info(`Đã đăng nhập. Session nằm trong ${dir}, các lần chạy sau dùng lại profile này.`);
        log.warn("Thư mục này chứa cookie Facebook — đã có trong .gitignore, đừng chia sẻ.");
    } finally {
        // Closing is what writes the session into the profile directory.
        await context.close();
    }
}
