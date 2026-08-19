import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeField, toCsv, toPostsCsv } from "../src/report/csv.js";
import { escapeHtml, renderMarkdown, renderReport } from "../src/report/html.js";

describe("escapeField", () => {
    it("leaves a plain value untouched", () => {
        assert.equal(escapeField("laptop"), "laptop");
    });

    it("quotes a value containing a comma", () => {
        assert.equal(escapeField("laptop, cũ"), '"laptop, cũ"');
    });

    it("quotes and doubles inner quotes", () => {
        assert.equal(escapeField('anh ấy nói "ok"'), '"anh ấy nói ""ok"""');
    });

    it("quotes a value containing a newline", () => {
        assert.equal(escapeField("dòng 1\ndòng 2"), '"dòng 1\ndòng 2"');
    });

    it("renders null and undefined as an empty field", () => {
        assert.equal(escapeField(null), "");
        assert.equal(escapeField(undefined), "");
    });
});

describe("toCsv", () => {
    const posts = [
        {
            groupName: "Nhóm A",
            score: 3,
            rules: ["Mua laptop"],
            text: "Cần mua laptop, giá tốt",
            permalink: "https://facebook.com/x/posts/1",
            collectedAt: "2026-07-31T00:00:00.000Z",
            analysis: {
                category: "cần mua",
                urgency: "cao",
                summary: "Người dùng cần mua laptop",
                entities: ["laptop"],
            },
        },
    ];

    it("starts with a UTF-8 BOM so Excel reads Vietnamese", () => {
        assert.equal(toCsv(posts).charCodeAt(0), 0xfeff);
    });

    it("emits a header row", () => {
        const [header] = toCsv(posts).slice(1).split("\r\n");
        assert.equal(
            header,
            "group,category,urgency,score,rules,summary,entities,text,permalink," +
                "author_name,author_url,author_id,collected_at",
        );
    });

    it("quotes a field containing a comma", () => {
        assert.match(toCsv(posts), /"Cần mua laptop, giá tốt"/);
    });

    it("uses CRLF line endings", () => {
        assert.ok(toCsv(posts).includes("\r\n"));
    });

    it("emits header only for an empty post list", () => {
        const rows = toCsv([]).slice(1).trimEnd().split("\r\n");
        assert.equal(rows.length, 1);
    });

    it("tolerates posts with no analysis", () => {
        const csv = toCsv([{ groupName: "B", text: "xin chào" }]);
        assert.ok(csv.includes("B,,,,,,,xin chào,,"));
    });
});

describe("toPostsCsv", () => {
    const posts = [
        {
            id: "fp1",
            groupId: "123",
            groupName: "Nhóm A",
            groupUrl: "https://www.facebook.com/groups/123",
            text: "Cần mua laptop, giá tốt",
            permalink: "https://facebook.com/x/posts/1",
            timeLabel: "31 Tháng 7, 2026",
            postedAt: "2026-07-31T00:00:00.000Z",
            collectedAt: "2026-08-01T00:00:00.000Z",
        },
    ];

    it("starts with a UTF-8 BOM so Excel reads Vietnamese", () => {
        assert.equal(toPostsCsv(posts).charCodeAt(0), 0xfeff);
    });

    it("emits the raw-post header row", () => {
        const [header] = toPostsCsv(posts).slice(1).split("\r\n");
        assert.equal(
            header,
            "id,group,group_id,group_url,posted_at,time_label,text,permalink," +
                "author_name,author_url,author_id,collected_at",
        );
    });

    it("carries no analysis or score columns", () => {
        const [header] = toPostsCsv(posts).slice(1).split("\r\n");
        assert.ok(!/score|category|urgency|summary/.test(header));
    });

    it("quotes a field containing a comma", () => {
        assert.match(toPostsCsv(posts), /"Cần mua laptop, giá tốt"/);
    });

    it("renders a post with no date as empty fields", () => {
        const csv = toPostsCsv([{ groupName: "B", text: "xin chào", postedAt: null }]);
        assert.ok(csv.includes(",B,,,,,xin chào,,"));
    });

    it("emits header only for an empty post list", () => {
        const rows = toPostsCsv([]).slice(1).trimEnd().split("\r\n");
        assert.equal(rows.length, 1);
    });
});

describe("escapeHtml", () => {
    it("escapes every HTML-significant character", () => {
        assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    });

    it("renders null as an empty string", () => {
        assert.equal(escapeHtml(null), "");
    });
});

describe("renderMarkdown", () => {
    it("renders headings", () => {
        assert.ok(renderMarkdown("## Đáng chú ý").includes("<h3>Đáng chú ý</h3>"));
    });

    it("renders bullet lists", () => {
        const html = renderMarkdown("- một\n- hai");
        assert.ok(html.includes("<ul><li>một</li><li>hai</li></ul>"));
    });

    it("renders bold spans", () => {
        assert.ok(renderMarkdown("**quan trọng**").includes("<strong>quan trọng</strong>"));
    });

    it("renders underscore italics", () => {
        assert.ok(renderMarkdown("_không có tóm tắt_").includes("<em>không có tóm tắt</em>"));
    });

    it("leaves underscores inside a word alone", () => {
        assert.ok(renderMarkdown("biến my_var_name ở đây").includes("my_var_name"));
    });

    it("renders plain lines as paragraphs", () => {
        assert.ok(renderMarkdown("xin chào").includes("<p>xin chào</p>"));
    });

    it("joins a paragraph wrapped across several lines", () => {
        assert.equal(renderMarkdown("một câu\nbị xuống dòng"), "<p>một câu bị xuống dòng</p>");
    });

    it("keeps a heading out of the paragraph that follows it", () => {
        assert.equal(renderMarkdown("## Tiêu đề\nnội dung"), "<h3>Tiêu đề</h3><p>nội dung</p>");
    });

    it("escapes markup embedded in post-derived text", () => {
        const html = renderMarkdown("- <script>alert(1)</script>");
        assert.ok(!html.includes("<script>"));
        assert.ok(html.includes("&lt;script&gt;"));
    });
});

describe("renderReport", () => {
    const input = {
        posts: [
            {
                groupName: "Nhóm A",
                text: "Cần mua laptop",
                score: 3,
                rules: ["Mua laptop"],
                permalink: "https://facebook.com/x/posts/1",
                analysis: {
                    category: "cần mua",
                    urgency: "cao",
                    summary: "Cần mua laptop cũ",
                    entities: ["laptop"],
                },
            },
        ],
        digest: "## Đáng chú ý\n- Một bài cần mua laptop",
        stats: { collected: 10, fresh: 1, matched: 1, groups: 1 },
    };

    it("produces a self-contained document with no external requests", () => {
        const html = renderReport(input);
        assert.ok(html.startsWith("<!doctype html>"));
        // The filter bar ships as an inline script; nothing may be fetched.
        assert.ok(!/<link\b/i.test(html));
        assert.ok(!/<script[^>]*\bsrc=/i.test(html));
        assert.ok(!/https?:\/\/(?!(www\.)?facebook\.com)/.test(html));
    });

    it("includes the stats, digest, and post body", () => {
        const html = renderReport(input);
        assert.ok(html.includes(">10<"));
        assert.ok(html.includes("Đáng chú ý"));
        assert.ok(html.includes("Cần mua laptop"));
    });

    it("escapes markup coming from post text", () => {
        const html = renderReport({
            ...input,
            posts: [{ groupName: "A", text: '<img src=x onerror="alert(1)">' }],
        });
        // The payload survives as inert text, not as a tag: no `<img` element
        // is emitted, and the quotes that would close an attribute are escaped.
        assert.ok(!/<img\b/i.test(html));
        assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
    });

    it("renders an empty-state message when nothing matched", () => {
        const html = renderReport({ posts: [], digest: "", stats: input.stats });
        assert.ok(html.includes("Không có bài nào khớp bộ lọc"));
    });

    it("counts the urgent posts in the stat row", () => {
        const html = renderReport(input);
        assert.match(html, /<b>1<\/b><span>đánh dấu gấp<\/span>/);
    });

    const twoGroups = {
        ...input,
        posts: [
            { groupName: "Nhóm A", text: "bài A" },
            { groupName: "Nhóm B", text: "bài B" },
        ],
    };

    it("links each group section from the index", () => {
        const html = renderReport(twoGroups);
        assert.ok(html.includes(`<section class="group" id="nhom-nhom-a"`));
        assert.ok(html.includes(`href="#nhom-nhom-a"`));
        assert.ok(html.includes(`href="#nhom-nhom-b"`));
    });

    it("gives colliding group names distinct anchors", () => {
        const html = renderReport({
            ...input,
            posts: [
                { groupName: "Nhóm Ạ", text: "một" },
                { groupName: "Nhom a", text: "hai" },
            ],
        });
        assert.ok(html.includes(`id="nhom-nhom-a"`));
        assert.ok(html.includes(`id="nhom-nhom-a-2"`));
    });

    it("omits the index when every post is from one group", () => {
        assert.ok(!renderReport(input).includes('class="index"'));
    });

    it("puts urgent posts at the top of their group", () => {
        const html = renderReport({
            ...input,
            posts: [
                { groupName: "A", text: "bài thường", postedAt: "2026-08-02T00:00:00.000Z" },
                {
                    groupName: "A",
                    text: "bài gấp",
                    postedAt: "2026-08-01T00:00:00.000Z",
                    analysis: { urgency: "cao" },
                },
            ],
        });
        assert.ok(html.indexOf("bài gấp") < html.indexOf("bài thường"));
    });

    it("folds a post that is many short lines but few characters", () => {
        const short = Array.from({ length: 12 }, (_, i) => `dòng ${i}`).join("\n");
        assert.ok(short.length < 420);
        const html = renderReport({ ...input, posts: [{ groupName: "A", text: short }] });
        assert.ok(html.includes("<summary>Xem thêm</summary>"));
    });

    it("keeps a short post unfolded", () => {
        const html = renderReport({ ...input, posts: [{ groupName: "A", text: "một dòng" }] });
        assert.ok(!html.includes("<summary>"));
    });

    it("renders the filter bar hidden, with one chip per group", () => {
        const html = renderReport(twoGroups);
        assert.ok(html.includes(`<div class="toolbar" hidden>`));
        assert.equal((html.match(/class="chip"/g) ?? []).length, 2);
        assert.ok(html.includes(`data-target="nhom-nhom-a"`));
        // The search box matches on folded text, so "nhom a" finds "Nhóm A".
        assert.ok(html.includes(`data-fold="nhom a"`));
    });

    it("drops the chip row but keeps the filters for a single group", () => {
        const html = renderReport(input);
        assert.ok(html.includes(`<div class="toolbar" hidden>`));
        assert.ok(!html.includes(`class="chip"`));
    });

    it("renders no filter bar when nothing matched", () => {
        const html = renderReport({ posts: [], digest: "", stats: input.stats });
        assert.ok(!html.includes(`class="toolbar"`));
    });

    it("keys a post's read button on the permalink id", () => {
        const html = renderReport(input);
        assert.ok(html.includes(`data-key="p:1"`));
        assert.ok(html.includes(`data-act="read"`));
    });

    it("falls back to the post id when there is no permalink", () => {
        const html = renderReport({ ...input, posts: [{ groupName: "A", id: "abc", text: "x" }] });
        assert.ok(html.includes(`data-key="abc"`));
    });

    it("omits the read button for a post with no stable key", () => {
        const html = renderReport({ ...input, posts: [{ groupName: "A", text: "x" }] });
        assert.ok(!html.includes(`data-act="read"`));
    });

    it("carries posts from an earlier run into the same group section", () => {
        const html = renderReport({
            ...input,
            posts: [{ groupName: "Nhóm A", id: "new", text: "bài mới" }],
            previous: [{ groupName: "Nhóm A", id: "old", text: "bài cũ", previous: true }],
        });
        assert.ok(html.includes("bài mới"));
        assert.ok(html.includes("bài cũ"));
        assert.ok(html.includes(`<span class="tag past"`));
        assert.equal((html.match(/class="group"/g) ?? []).length, 1);
        assert.ok(html.includes(`<b>1</b><span>từ lần trước</span>`));
        assert.ok(html.includes(`data-act="only-new"`));
    });

    it('offers no "chỉ bài mới" button when nothing was carried over', () => {
        assert.ok(!renderReport(input).includes(`data-act="only-new"`));
        assert.ok(!renderReport(input).includes("từ lần trước"));
    });

    it("keeps a carried-over post out of the urgent band", () => {
        // It had its turn at the top of the report it first appeared in.
        const html = renderReport({
            ...input,
            posts: [{ groupName: "A", text: "bài mới", postedAt: "2026-08-19T00:00:00.000Z" }],
            previous: [
                {
                    groupName: "A",
                    text: "bài cũ gấp",
                    postedAt: "2026-08-14T00:00:00.000Z",
                    previous: true,
                    analysis: { urgency: "cao" },
                },
            ],
        });
        assert.ok(html.indexOf("bài mới") < html.indexOf("bài cũ gấp"));
    });

    it('marks urgent posts for the "chỉ gấp" filter', () => {
        const html = renderReport(twoGroups);
        assert.equal((html.match(/data-urgent="1"/g) ?? []).length, 0);
        assert.ok(renderReport(input).includes(`data-urgent="1"`));
    });
});
