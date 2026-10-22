#!/usr/bin/env node
/**
 * fb-group-digest — pipeline entry point.
 *
 *   login    save a Facebook session by signing in manually, once
 *   groups   list the group ids the signed-in account has joined
 *   collect  read the configured groups and dump raw posts
 *   analyze  filter by keyword, drop duplicates, classify with Claude
 *   report   render the HTML + CSV report
 *   send     email the most recent report
 *   open     open the most recent report in the browser
 *   run      collect → analyze → report → open → send
 *
 * Each stage writes its output to disk, so any stage can be re-run on its own
 * without repeating the one before it.
 *
 * Playwright, the Anthropic SDK and nodemailer are imported inside the command
 * that needs them rather than at the top of this file. They are by far the
 * heaviest things this program loads, and a static import made every command
 * pay for all three — `report`, which only reads a JSON file and writes two
 * text files, loaded a browser driver and two API clients before doing anything.
 */

import process from "node:process";
import { loadConfig, loadEnv } from "./config.js";
import { excludePosts, filterPosts } from "./filter/keywords.js";
import { log } from "./logger.js";
import { toCsv, toPostsCsv } from "./report/csv.js";
import { renderReport } from "./report/html.js";
import { latestReport, openInBrowser } from "./report/open.js";
import { addToHistory, loadHistory, recentHistory, saveHistory } from "./store/history.js";
import { readJson, writeJson, writeText } from "./store/io.js";
import { commitSeen, loadSeen, partitionBySeen, seenKeys } from "./store/seen.js";

const PATHS = {
    groups: "data/groups.json",
    posts: "data/posts.json",
    postsCsv: "data/posts.csv",
    analysis: "data/analysis.json",
    seen: "data/seen.json",
    history: "data/history.json",
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

/**
 * How many days back a report reaches for posts it already reported.
 *
 * A run often turns up only a handful of new posts, which reads as a scrap of
 * paper rather than a digest; pulling the last week in gives it continuity.
 * `--history 0` turns it off.
 */
const DEFAULT_HISTORY_DAYS = 7;

/** @returns {string} e.g. "2026-07-31" */
function today() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Apply the config's "exclude" rules and log what each one took out.
 *
 * @param {Array<object>} posts
 * @param {object[]} rules
 * @param {string} what Label for the log line, e.g. "bài mới".
 */
function dropExcluded(posts, rules, what) {
    const { kept, dropped } = excludePosts(posts, rules);
    const total = posts.length - kept.length;
    if (total > 0) {
        const detail = [...dropped].map(([name, n]) => `${name}: ${n}`).join(", ");
        log.info(`Loại ${total}/${posts.length} ${what} (${detail}).`);
    }
    return kept;
}

/**
 * A raw report is written next to the real one under its own name: it is a
 * different thing — no classification, no seen bookkeeping — and overwriting
 * the day's actual report with it would lose work that cost Claude calls.
 *
 * @param {Record<string, string>} flags
 */
function reportPaths(flags) {
    const stamp = flags.date ?? today();
    const base = flags.raw === "true" ? "preview" : "report";
    return {
        html: flags.html ?? `out/${base}-${stamp}.html`,
        csv: flags.csv ?? `out/${base}-${stamp}.csv`,
    };
}

/**
 * An analysis-shaped object built straight from data/posts.json.
 *
 * The classification fields are simply absent, which the renderer already
 * handles — a post whose Claude call failed reaches it the same way. This is
 * the "show me what collect brought back" view, and it costs nothing.
 *
 * @returns {Promise<object>}
 */
async function rawAnalysis(exclude) {
    const collected = await readJson(PATHS.posts, null);
    if (collected === null) {
        throw new Error(`Chưa có ${PATHS.posts}. Chạy "npm run collect" trước.`);
    }
    const posts = dropExcluded(collected, exclude, "bài");

    return {
        generatedAt: new Date().toISOString(),
        stats: {
            collected: collected.length,
            matched: posts.length,
            fresh: posts.length,
            duplicates: 0,
            groups: new Set(posts.map((post) => post.groupName)).size,
        },
        digest:
            "_Bản xem nhanh dữ liệu thô — chưa chạy `analyze`, nên không có " +
            "phân loại, mức độ gấp và tóm tắt._",
        posts,
    };
}

/**
 * List the groups the signed-in account belongs to, with their ids.
 *
 * This is the step before `collect`: the config needs a group url per group,
 * and the ids are only readable from inside a signed-in session. The result is
 * written to data/groups.json, and `--write` appends the new ones straight into
 * the config's "groups" array without touching what is already there.
 */
async function cmdGroups(flags) {
    const [{ closeSession, openSession }, { listJoinedGroups }] = await Promise.all([
        import("./collect/browser.js"),
        import("./collect/groups.js"),
    ]);

    const session = await openSession();
    let groups;
    try {
        groups = await listJoinedGroups(session.page, {
            resolveIds: flags["no-resolve"] !== "true",
        });
    } finally {
        await closeSession(session);
    }

    if (groups.length === 0) {
        throw new Error(
            "Không thấy nhóm nào. Kiểm tra bằng cách mở facebook.com/groups/joins/ " +
                'trong trình duyệt, hoặc chạy "npm run login" nếu session đã hết hạn.',
        );
    }

    const out = flags.out ?? PATHS.groups;
    await writeJson(out, groups);

    for (const group of groups) {
        log.info(
            `${group.id.padEnd(20)} ${group.name === "" ? "(không đọc được tên)" : group.name}`,
        );
    }
    log.info(`${groups.length} nhóm → ${out}`);

    if (flags.write === "true") await writeGroupsIntoConfig(flags, groups);
    else log.info('Thêm "--write" để chép các nhóm này vào config.');

    return groups;
}

/**
 * Append the newly found groups to the config file, keeping every other key —
 * rules, minScore, the comment block — exactly as it was.
 *
 * @param {Record<string, string>} flags
 * @param {Array<object>} groups
 */
async function writeGroupsIntoConfig(flags, groups) {
    const { mergeConfigGroups } = await import("./collect/groups.js");
    const path = flags.config ?? "config/groups.json";
    const config = (await readJson(path, null)) ?? { groups: [], rules: [], minScore: 0 };
    const existing = Array.isArray(config.groups) ? config.groups : [];

    const merged = mergeConfigGroups(existing, groups);
    if (merged.added.length === 0) {
        log.info(`${path} đã có đủ ${groups.length} nhóm này — không sửa gì.`);
        return;
    }

    await writeJson(path, { ...config, groups: merged.groups });
    log.info(`Đã thêm ${merged.added.length} nhóm mới vào ${path}.`);
}

async function cmdCollect(flags) {
    const [{ closeSession, openSession }, { collectAll }] = await Promise.all([
        import("./collect/browser.js"),
        import("./collect/scrape.js"),
    ]);
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
    const { buildDigest, classifyPosts } = await import("./analyze/claude.js");
    const config = await loadConfig(flags.config ?? "config/groups.json");
    const posts = await readJson(PATHS.posts, null);

    if (posts === null) {
        throw new Error(`Chưa có ${PATHS.posts}. Chạy "npm run collect" trước.`);
    }

    log.step(`Lọc từ khoá trên ${posts.length} bài…`);
    const wanted = dropExcluded(posts, config.exclude, "bài");
    const matched = filterPosts(wanted, config.rules, { minScore: config.minScore });
    log.info(`${matched.length} bài khớp bộ lọc.`);

    // `--all` ignores the seen index, the same way it does for `collect`. It is
    // the way back from a run that reported everything before you read it: the
    // posts are re-classified and land in the history archive, so the next
    // report can carry them. It costs a full round of Claude calls, hence the
    // warning rather than a quiet re-run.
    const startOver = flags.all === "true";
    const seen = await loadSeen(PATHS.seen);
    const { fresh, duplicates } = startOver
        ? { fresh: matched, duplicates: [] }
        : partitionBySeen(matched, seen);

    if (startOver)
        log.warn(`--all: phân tích lại cả ${matched.length} bài, tốn thêm lời gọi Claude.`);
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

    // Archived here rather than in `report`, so the classification is stored
    // once and every later report reuses it — showing a week of posts costs no
    // extra Claude calls.
    const history = await loadHistory(PATHS.history);
    await saveHistory(PATHS.history, addToHistory(history, classified));

    log.info(`Đã lưu kết quả phân tích vào ${PATHS.analysis}`);
    return analysis;
}

async function cmdReport(flags) {
    const raw = flags.raw === "true";
    const config = await loadConfig(flags.config ?? "config/groups.json");
    const analysis = raw ? await rawAnalysis(config.exclude) : await readJson(PATHS.analysis, null);
    if (analysis === null) {
        throw new Error(`Chưa có ${PATHS.analysis}. Chạy "npm run analyze" trước.`);
    }

    const days = flags.history === undefined ? DEFAULT_HISTORY_DAYS : Number(flags.history);
    if (!Number.isFinite(days) || days < 0) {
        throw new Error(`--history phải là số ngày không âm, nhận được "${flags.history}".`);
    }

    // analyze already applied "exclude", but an analysis or archive written
    // before a rule was added still holds what it now rules out. Filtering
    // again here lets a new rule show up on the next report without paying
    // for another round of Claude calls. A raw analysis was filtered just now.
    const posts = raw ? analysis.posts : dropExcluded(analysis.posts, config.exclude, "bài");

    // A raw report already shows every post on disk, so there is nothing for
    // the history archive to add — and nothing in it has been reported yet.
    const previous = raw
        ? []
        : dropExcluded(
              recentHistory(await loadHistory(PATHS.history), analysis.posts, { days }),
              config.exclude,
              "bài cũ",
          );
    if (previous.length > 0) {
        log.info(`Kèm ${previous.length} bài đã báo cáo trong ${days} ngày qua.`);
    }

    const out = reportPaths(flags);
    // The CSV stays this run's posts only: it is the machine-readable record of
    // what was new, and repeating last week's rows in every file would ruin it.
    await writeText(out.html, renderReport({ ...analysis, posts, previous }));
    await writeText(out.csv, toCsv(posts));

    // Mark as seen only now — if report generation had failed, these posts
    // should still show up on the next run. A raw report marks nothing: it is
    // a preview, and the posts in it have not been reported to anyone. The
    // excluded ones are marked too: they were read, just not wanted.
    if (!raw) {
        const seen = await loadSeen(PATHS.seen);
        await commitSeen(PATHS.seen, seen, analysis.posts);
    }

    log.info(`Báo cáo: ${out.html}`);
    log.info(`CSV:     ${out.csv}`);
    return out;
}

async function cmdSend(flags) {
    const { sendReport } = await import("./mail/send.js");
    const out = reportPaths(flags);
    await sendReport({ htmlPath: out.html, csvPath: out.csv });
}

async function cmdOpen(flags) {
    const path = flags.html ?? (await latestReport());
    if (path === null) {
        throw new Error('Chưa có báo cáo nào trong out/. Chạy "npm run report" trước.');
    }
    log.info(`Mở ${path}`);
    openInBrowser(path);
}

async function cmdRun(flags) {
    await cmdCollect(flags);
    await cmdAnalyze(flags);
    const out = await cmdReport(flags);
    if (flags["no-open"] !== "true") openInBrowser(out.html);

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
  groups             Liệt kê id các nhóm tài khoản đang tham gia
  collect            Đọc các nhóm trong config, lưu bài thô (JSON + CSV)
  mark-read          Đánh dấu các bài đang có là đã đọc, lần sau bỏ qua
  analyze            Lọc từ khoá + khử trùng lặp + phân tích bằng Claude
  report             Sinh báo cáo HTML và CSV
  send               Gửi báo cáo gần nhất qua email
  open               Mở báo cáo gần nhất trong trình duyệt
  run                Chạy toàn bộ: collect → analyze → report → mở → send

Tuỳ chọn:
  --config <path>    File cấu hình nhóm/từ khoá (mặc định config/groups.json)
  --all              Với "collect": bỏ qua bộ nhớ, lấy lại tất cả và ghi đè
                     Với "analyze": phân tích lại cả bài đã báo cáo lần trước
  --from <nguồn>     Với "mark-read": "posts" (mặc định) hoặc "analysis"
  --write            Với "groups": chép các nhóm mới tìm được vào config
  --no-resolve       Với "groups": không mở từng nhóm để đổi slug chữ ra id số
  --out <path>       Với "groups": ghi đè đường dẫn JSON (mặc định
                     data/groups.json)
  --date <yyyy-mm-dd>  Ngày dùng để đặt tên file báo cáo (mặc định hôm nay)
  --html <path>      Ghi đè đường dẫn file HTML
  --csv <path>       Ghi đè đường dẫn file CSV báo cáo
  --posts-csv <path>   Với "collect": ghi đè đường dẫn CSV bài thô
                       (mặc định data/posts.csv)
  --raw              Với "report": dựng báo cáo thẳng từ data/posts.json,
                     bỏ qua analyze — ghi ra out/preview-<ngày>.html
  --history <ngày>   Với "report": kèm lại bài đã báo cáo trong N ngày qua
                     (mặc định 7, dùng 0 để chỉ hiện bài mới)
  --no-mail          Với "run": tạo báo cáo nhưng không gửi mail
  --no-open          Với "run": không tự mở báo cáo trong trình duyệt
`);
}

const COMMANDS = {
    login: async (flags) => (await import("./collect/login.js")).runLogin(flags),
    groups: cmdGroups,
    collect: cmdCollect,
    "mark-read": cmdMarkRead,
    analyze: cmdAnalyze,
    report: cmdReport,
    send: cmdSend,
    open: cmdOpen,
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
