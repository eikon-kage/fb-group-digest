import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileRules, excludePosts, filterPosts, scoreText } from "../src/filter/keywords.js";

describe("compileRules", () => {
    it("rejects a rule without a name", () => {
        assert.throws(() => compileRules([{ any: ["laptop"] }]), /missing a name/);
    });

    it("rejects a rule with no clauses", () => {
        assert.throws(() => compileRules([{ name: "empty" }]), /can never match/);
    });

    it("rejects a non-string-array clause", () => {
        assert.throws(() => compileRules([{ name: "bad", any: [42] }]), /must be string\[\]/);
    });

    it("rejects an invalid regex", () => {
        assert.throws(() => compileRules([{ name: "bad", regex: ["([a-z"] }]), /invalid regex/);
    });

    it("defaults weight to 1", () => {
        assert.equal(compileRules([{ name: "r", any: ["x"] }])[0].weight, 1);
    });
});

describe("scoreText", () => {
    const rules = compileRules([
        { name: "Cần mua laptop", all: ["cần mua"], any: ["laptop", "macbook"], weight: 3 },
        { name: "Tuyển dụng", any: ["tuyển", "hiring"], weight: 2 },
    ]);

    it("matches when all and any clauses are satisfied", () => {
        const result = scoreText("Mình cần mua laptop cũ giá tốt", rules);
        assert.equal(result.score, 3);
        assert.deepEqual(result.rules, ["Cần mua laptop"]);
    });

    it("matches diacritic-free input", () => {
        assert.equal(scoreText("minh can mua macbook", rules).score, 3);
    });

    it("does not match when the any clause fails", () => {
        assert.equal(scoreText("Cần mua bàn phím", rules).score, 0);
    });

    it("does not match when an all term is missing", () => {
        assert.equal(scoreText("Bán laptop cũ", rules).score, 0);
    });

    it("sums the weights of every matching rule", () => {
        const result = scoreText("Cần mua laptop cho bạn mới tuyển", rules);
        assert.equal(result.score, 5);
        assert.equal(result.rules.length, 2);
    });

    it("reports the terms that triggered the match", () => {
        const result = scoreText("cần mua macbook", rules);
        assert.ok(result.hits.includes("cần mua"));
        assert.ok(result.hits.includes("macbook"));
    });

    it("deduplicates hits across rules", () => {
        const overlapping = compileRules([
            { name: "a", any: ["laptop"] },
            { name: "b", any: ["laptop"] },
        ]);
        assert.deepEqual(scoreText("bán laptop", overlapping).hits, ["laptop"]);
    });
});

describe("scoreText none clause", () => {
    const rules = compileRules([
        { name: "Cần mua", all: ["cần mua"], none: ["đã mua", "đã có"], weight: 1 },
    ]);

    it("disqualifies the rule when an excluded term appears", () => {
        assert.equal(scoreText("Cần mua laptop nhưng đã mua rồi", rules).score, 0);
    });

    it("matches when no excluded term appears", () => {
        assert.equal(scoreText("Cần mua laptop", rules).score, 1);
    });

    it("applies the exclusion to diacritic-free text too", () => {
        assert.equal(scoreText("can mua laptop, da mua roi", rules).score, 0);
    });
});

describe("scoreText regex clause", () => {
    // Patterns run against the folded text, so they are written without diacritics.
    const rules = compileRules([
        { name: "Giá", regex: ["\\d+\\s*(tr|trieu)"], any: ["bán"], weight: 1 },
    ]);

    it("matches when the pattern hits", () => {
        assert.equal(scoreText("Bán laptop 15 triệu", rules).score, 1);
    });

    it("does not match when the pattern misses", () => {
        assert.equal(scoreText("Bán laptop giá tốt", rules).score, 0);
    });

    it("requires every pattern to match", () => {
        const both = compileRules([{ name: "r", regex: ["laptop", "\\d+ tr"] }]);
        assert.equal(scoreText("laptop cu", both).score, 0);
        assert.equal(scoreText("laptop 15 tr", both).score, 1);
    });
});

describe("filterPosts", () => {
    const posts = [
        { id: "1", text: "Cần mua laptop cũ" },
        { id: "2", text: "Hôm nay trời đẹp quá" },
        { id: "3", text: "Cần mua laptop, đang tuyển thêm người" },
    ];
    const rules = [
        { name: "Mua laptop", all: ["cần mua"], any: ["laptop"], weight: 3 },
        { name: "Tuyển dụng", any: ["tuyển"], weight: 2 },
    ];

    it("keeps only posts at or above minScore", () => {
        const kept = filterPosts(posts, rules, { minScore: 1 });
        assert.deepEqual(
            kept.map((post) => post.id),
            ["3", "1"],
        );
    });

    it("sorts by descending score", () => {
        const kept = filterPosts(posts, rules, { minScore: 1 });
        assert.equal(kept[0].score, 5);
        assert.equal(kept[1].score, 3);
    });

    it("honours a higher minScore", () => {
        const kept = filterPosts(posts, rules, { minScore: 5 });
        assert.deepEqual(
            kept.map((post) => post.id),
            ["3"],
        );
    });

    it("preserves the original post fields", () => {
        const [first] = filterPosts(posts, rules, { minScore: 5 });
        assert.equal(first.text, "Cần mua laptop, đang tuyển thêm người");
    });

    it("returns an empty array when nothing matches", () => {
        assert.deepEqual(filterPosts([{ id: "9", text: "xin chào" }], rules), []);
    });
});

describe("minYears", () => {
    const rules = compileRules([{ name: "5+ năm", minYears: 5 }]);
    const matches = (text) => scoreText(text, rules).score > 0;

    it("reads the usual ways of asking for five years", () => {
        for (const text of [
            "Yêu cầu 5+ năm kinh nghiệm ReactJS",
            "tuyển ReactJS từ 5 yoe",
            "senior reactnative 5y+ ko cần eng",
            "Kinh nghiệm: tối thiểu 5 năm",
            "5+ years of frontend development",
            "có từ 5–7 năm kinh nghiệm fullstack",
            "cần gấp .NET từ 6 năm, onboard ngay",
            "leader (>5+exp) có kinh nghiệm bank",
            "10+ năm kinh nghiệm",
        ]) {
            assert.ok(matches(text), text);
        }
    });

    it("counts a range by its lower end", () => {
        assert.ok(!matches("tìm frontend 3 - 5 năm thực chiến"));
        assert.ok(!matches("cần reactjs 4-5yoe, đi làm ngay"));
        assert.ok(!matches("dự án cần RN 4.5-5 năm, non eng"));
    });

    it("ignores figures below the threshold and years that are not experience", () => {
        assert.ok(!matches("yêu cầu 3+ năm kinh nghiệm"));
        assert.ok(!matches("từ 4.5 năm kinh nghiệm"));
        assert.ok(!matches("sau 6 năm, chúng mình đang bước vào giai đoạn mới"));
        assert.ok(!matches("không cần 7–8 năm kinh nghiệm, 3 năm là đủ"));
        assert.ok(!matches("lương upto 55m, hợp đồng dài hạn"));
    });

    it("rejects a non-positive minYears", () => {
        assert.throws(() => compileRules([{ name: "bad", minYears: 0 }]), /positive number/);
    });
});

describe("excludePosts", () => {
    const rules = [
        { name: "Fullstack", any: ["fullstack"] },
        { name: "HCM", any: ["hcm", "sài gòn"], none: ["hn", "hà nội"] },
    ];
    const posts = [
        { id: "1", text: "Tuyển ReactJS tại Cầu Giấy" },
        { id: "2", text: "Tuyển Fullstack NodeJS" },
        { id: "3", text: "[HCM] tuyển frontend" },
        { id: "4", text: "[HN/HCM] tuyển frontend" },
    ];

    it("keeps only posts that match no rule", () => {
        const { kept } = excludePosts(posts, rules);
        assert.deepEqual(
            kept.map((post) => post.id),
            ["1", "4"],
        );
    });

    it("counts drops per rule", () => {
        const { dropped } = excludePosts(posts, rules);
        assert.deepEqual(
            [...dropped],
            [
                ["Fullstack", 1],
                ["HCM", 1],
            ],
        );
    });
});
