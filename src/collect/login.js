/**
 * One-time interactive login.
 *
 * Opens a visible browser and waits for you to sign in by hand — including any
 * 2FA or checkpoint step. Nothing is automated here and no credentials are read
 * from config; the script only saves the resulting cookies so later runs do not
 * have to log in again.
 */

import { chromium } from "playwright";
import { env } from "../config.js";
import { log } from "../logger.js";

const LOGGED_IN_TIMEOUT_MS = 5 * 60 * 1000;

export async function runLogin() {
    const statePath = env("FB_STORAGE_STATE", "./storage-state.json");

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ locale: "vi-VN" });
    const page = await context.newPage();

    log.info("Mở Facebook — đăng nhập bằng tay trong cửa sổ vừa hiện ra.");
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded" });

    log.info("Đang đợi bạn đăng nhập xong (tối đa 5 phút)…");
    try {
        // The composer only renders for a logged-in session, so it is a
        // reliable "we're in" signal across Facebook's layout variants.
        await page.waitForSelector(
            '[role="navigation"], [aria-label="Trang chủ"], [aria-label="Home"]',
            {
                timeout: LOGGED_IN_TIMEOUT_MS,
            },
        );
    } catch {
        await browser.close();
        throw new Error("Hết thời gian chờ đăng nhập. Chạy lại `npm run login`.");
    }

    await context.storageState({ path: statePath });
    await browser.close();

    log.info(`Đã lưu session vào ${statePath}`);
    log.warn("File này chứa cookie Facebook của bạn — đã có trong .gitignore, đừng chia sẻ.");
}
