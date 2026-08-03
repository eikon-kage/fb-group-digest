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

    it("renders plain lines as paragraphs", () => {
        assert.ok(renderMarkdown("xin chào").includes("<p>xin chào</p>"));
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
        assert.ok(!/<(script|link)\b/i.test(html));
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
});
