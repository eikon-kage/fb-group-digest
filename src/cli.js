#!/usr/bin/env node
/**
 * fb-group-digest — pipeline entry point.
 *
 *   login    save a Facebook session by signing in manually, once
 *   collect  read the configured groups and dump raw posts
 *   analyze  filter by keyword, drop duplicates, classify with Claude
 *   report   render the HTML + CSV report
 *   send     email the most recent report
 *   run      collect → analyze → report → send
 *
 * Each stage writes its output to disk, so any stage can be re-run on its own
 * without repeating the one before it.
 */

import process from "node:process";
import { buildDigest, classifyPosts } from "./analyze/claude.js";
import { closeSession, openSession } from "./collect/browser.js";
import { runLogin } from "./collect/login.js";
import { collectAll } from "./collect/scrape.js";
import { loadConfig, loadEnv } from "./config.js";
import { filterPosts } from "./filter/keywords.js";
import { log } from "./logger.js";
import { sendReport } from "./mail/send.js";
import { toCsv, toPostsCsv } from "./report/csv.js";
import { renderReport } from "./report/html.js";
import { readJson, writeJson, writeText } from "./store/io.js";
import { commitSeen, loadSeen, partitionBySeen, seenKeys } from "./store/seen.js";

const PATHS = {
    posts: "data/posts.json",
    postsCsv: "data/posts.csv",
    analysis: "data/analysis.json",
    seen: "data/seen.json",
};

/**
 * @param {string[]} argv
 * @returns {{ command: string, flags: Record<string, string> }}
 */
function parseArgs(argv) {
    const [command = "help", ...rest] = argv;
    const flags = {};

    for (let i = 0; i < rest.length; i++) {
        if (!rest[i].startsWith("--")) continue;
        const key = rest[i].slice(2);
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("--")) {
            flags[key] = "true";
        } else {
            flags[key] = next;
            i++;
        }
    }

    return { command, flags };
}

/** @returns {string} e.g. "2026-07-31" */
function today() {
    return new Date().toISOString().slice(0, 10);
}

/** @param {Record<string, string>} flags */
function reportPaths(flags) {
    const stamp = flags.date ?? today();
    return {
        html: flags.html ?? `out/report-${stamp}.html`,
        csv: flags.csv ?? `out/report-${stamp}.csv`,
    };
}

async function cmdCollect(flags) {
    const config = await loadConfig(flags.config ?? "config/groups.json");
    const startOver = flags.all === "true";

    // Two things count as "already have it": posts a previous report recorded,
    // and posts still sitting in posts.json from an earlier collect. Without
    // the second, running collect twice re-walked the whole feed and then
    // overwrote the file with the result.
    const previous = startOver ? [] : await loadPreviousPosts();
    const skip = startOver ? {} : await loadSeen(PATHS.seen);
    for (const post of previous) {
        for (const key of seenKeys(post)) skip[key] = post.collectedAt ?? new Date().toISOString();
    }

    if (previous.length > 0) log.step(`Đã có sẵn ${previous.length} bài, chỉ lấy bài mới.`);

    const session = await openSession();

    try {
        const fresh = await collectAll(session.page, config.groups, { seen: skip });
        const all = [...previous, ...fresh];

        // JSON feeds the next stage; the CSV is the same data in a form you can
        // open in Excel without running analyze/report.
        const csvPath = flags["posts-csv"] ?? PATHS.postsCsv;
        await writeJson(PATHS.posts, all);
        await writeText(csvPath, toPostsCsv(all));

        log.info(`Thêm ${fresh.length} bài mới — tổng ${all.length} bài trong ${PATHS.posts}`);
        log.info(`CSV:     ${csvPath}`);
        return all;
    } finally {
        await closeSession(session);
    }
}

/** Posts left by an earlier collect, or an empty list if the file is unusable. */
async function loadPreviousPosts() {
    const data = await readJson(PATHS.posts, []);
    return Array.isArray(data) ? data : [];
}

/**
 * Mark the posts on disk as read so later runs skip them.
 *
 * The pipeline normally records posts as seen once a report is written. This
 * is the manual equivalent, for when you have looked through data/posts.json
 * and want the next collect to start after it.
 */
async function cmdMarkRead(flags) {
    const source = flags.from === "analysis" ? PATHS.analysis : PATHS.posts;
    const data = await readJson(source, null);

    if (data === null) {
        throw new Error(`Chưa có ${source}. Chạy "npm run collect" trước.`);
    }

    const posts = Array.isArray(data) ? data : (data.posts ?? []);
    if (posts.length === 0) {
        log.warn(`${source} không có bài nào — không đánh dấu gì.`);
        return;
    }

    const seen = await loadSeen(PATHS.seen);
    const before = Object.keys(seen).length;
    const next = await commitSeen(PATHS.seen, seen, posts);
    const added = Object.keys(next).length - before;

    log.info(`Đã đánh dấu ${posts.length} bài là đã đọc (${added} khoá mới trong ${PATHS.seen}).`);
    log.info(`Lần "collect" sau sẽ bỏ qua chúng. Dùng "--all" nếu muốn lấy lại.`);
}

async function cmdAnalyze(flags) {
    const config = await loadConfig(flags.config ?? "config/groups.json");
    const posts = await readJson(PATHS.posts, null);

    if (posts === null) {
        throw new Error(`Chưa có ${PATHS.posts}. Chạy "npm run collect" trước.`);
    }

    log.step(`Lọc từ khoá trên ${posts.length} bài…`);
    const matched = filterPosts(posts, config.rules, { minScore: config.minScore });
    log.info(`${matched.length} bài khớp bộ lọc.`);

    const seen = await loadSeen(PATHS.seen);
    const { fresh, duplicates } = partitionBySeen(matched, seen);
    if (duplicates.length > 0) log.info(`Bỏ qua ${duplicates.length} bài đã báo cáo lần trước.`);

    log.step("Phân tích bằng Claude…");
    const classified = await classifyPosts(fresh);
    const digest = await buildDigest(classified);

    const analysis = {
        generatedAt: new Date().toISOString(),
        stats: {
            collected: posts.length,
            matched: matched.length,
            fresh: fresh.length,
            duplicates: duplicates.length,
            groups: new Set(posts.map((post) => post.groupName)).size,
        },
        digest,
        posts: classified,
    };

    await writeJson(PATHS.analysis, analysis);
    log.info(`Đã lưu kết quả phân tích vào ${PATHS.analysis}`);
    return analysis;
}

async function cmdReport(flags) {
    const analysis = await readJson(PATHS.analysis, null);
    if (analysis === null) {
        throw new Error(`Chưa có ${PATHS.analysis}. Chạy "npm run analyze" trước.`);
    }

    const out = reportPaths(flags);
    await writeText(out.html, renderReport(analysis));
    await writeText(out.csv, toCsv(analysis.posts));

    // Mark as seen only now — if report generation had failed, these posts
    // should still show up on the next run.
    const seen = await loadSeen(PATHS.seen);
    await commitSeen(PATHS.seen, seen, analysis.posts);

    log.info(`Báo cáo: ${out.html}`);
    log.info(`CSV:     ${out.csv}`);
    return out;
}

async function cmdSend(flags) {
    const out = reportPaths(flags);
    await sendReport({ htmlPath: out.html, csvPath: out.csv });
}

async function cmdRun(flags) {
    await cmdCollect(flags);
    await cmdAnalyze(flags);
    await cmdReport(flags);

    if (flags["no-mail"] === "true") {
        log.info("Bỏ qua bước gửi mail (--no-mail).");
        return;
    }
    await cmdSend(flags);
}

function printHelp() {
    console.log(`
fb-group-digest — tóm tắt bài đăng nhóm Facebook

  node src/cli.js <lệnh> [tuỳ chọn]

Lệnh:
  login              Đăng nhập Facebook bằng tay và lưu session
  collect            Đọc các nhóm trong config, lưu bài thô (JSON + CSV)
  mark-read          Đánh dấu các bài đang có là đã đọc, lần sau bỏ qua
  analyze            Lọc từ khoá + khử trùng lặp + phân tích bằng Claude
  report             Sinh báo cáo HTML và CSV
  send               Gửi báo cáo gần nhất qua email
  run                Chạy toàn bộ: collect → analyze → report → send

Tuỳ chọn:
  --config <path>    File cấu hình nhóm/từ khoá (mặc định config/groups.json)
  --all              Với "collect": bỏ qua bộ nhớ, lấy lại tất cả và ghi đè
  --from <nguồn>     Với "mark-read": "posts" (mặc định) hoặc "analysis"
  --date <yyyy-mm-dd>  Ngày dùng để đặt tên file báo cáo (mặc định hôm nay)
  --html <path>      Ghi đè đường dẫn file HTML
  --csv <path>       Ghi đè đường dẫn file CSV báo cáo
  --posts-csv <path>   Với "collect": ghi đè đường dẫn CSV bài thô
                       (mặc định data/posts.csv)
  --no-mail          Với "run": tạo báo cáo nhưng không gửi mail
`);
}

const COMMANDS = {
    login: runLogin,
    collect: cmdCollect,
    "mark-read": cmdMarkRead,
    analyze: cmdAnalyze,
    report: cmdReport,
    send: cmdSend,
    run: cmdRun,
    help: printHelp,
};

async function main() {
    await loadEnv();
    const { command, flags } = parseArgs(process.argv.slice(2));

    const handler = COMMANDS[command];
    if (!handler) {
        log.error(`Lệnh không hợp lệ: ${command}`);
        printHelp();
        process.exitCode = 1;
        return;
    }

    await handler(flags);
}

main().catch((error) => {
    log.error(error.message);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
});
