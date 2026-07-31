/** Email delivery over SMTP. The HTML report is the body; CSV rides along as an attachment. */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import nodemailer from "nodemailer";
import { env, envBool, envInt } from "../config.js";
import { log } from "../logger.js";

/**
 * @returns {import("nodemailer").Transporter}
 */
function transport() {
    const host = env("SMTP_HOST");
    const user = env("SMTP_USER");
    const pass = env("SMTP_PASS");

    const missing = [
        ["SMTP_HOST", host],
        ["SMTP_USER", user],
        ["SMTP_PASS", pass],
    ]
        .filter(([, value]) => value === "")
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(`Thiếu cấu hình SMTP: ${missing.join(", ")}. Xem .env.example.`);
    }

    return nodemailer.createTransport({
        host,
        port: envInt("SMTP_PORT", 587),
        secure: envBool("SMTP_SECURE", false),
        auth: { user, pass },
    });
}

/**
 * @param {object} input
 * @param {string} input.htmlPath
 * @param {string} [input.csvPath]
 * @param {string} [input.subject]
 */
export async function sendReport({ htmlPath, csvPath, subject }) {
    const to = env("MAIL_TO");
    if (to === "") throw new Error("Thiếu MAIL_TO trong .env");

    const html = await readFile(resolve(htmlPath), "utf8");
    const attachments = [];

    if (csvPath) {
        attachments.push({
            filename: basename(csvPath),
            content: await readFile(resolve(csvPath)),
            contentType: "text/csv; charset=utf-8",
        });
    }

    const today = new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

    const info = await transport().sendMail({
        from: env("MAIL_FROM", to),
        to,
        subject: subject ?? `Báo cáo nhóm Facebook — ${today}`,
        html,
        attachments,
    });

    log.info(`Đã gửi mail tới ${to} (id: ${info.messageId})`);
    return info;
}
