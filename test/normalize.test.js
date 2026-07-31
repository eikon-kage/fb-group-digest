import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containsTerm, fingerprint, fold, tidy } from "../src/filter/normalize.js";

describe("fold", () => {
    it("strips Vietnamese diacritics", () => {
        assert.equal(fold("Cần mua laptop"), "can mua laptop");
        assert.equal(fold("Tuyển dụng lập trình viên"), "tuyen dung lap trinh vien");
    });

    it("maps đ and Đ to d", () => {
        assert.equal(fold("Đà Nẵng"), "da nang");
        assert.equal(fold("điện thoại"), "dien thoai");
    });

    it("folds text with and without diacritics to the same form", () => {
        assert.equal(fold("cần mua"), fold("CAN MUA"));
        assert.equal(fold("Nguyễn"), fold("nguyen"));
    });

    it("collapses whitespace and trims", () => {
        assert.equal(fold("  cần   mua \n laptop  "), "can mua laptop");
    });

    it("returns an empty string for non-string input", () => {
        assert.equal(fold(undefined), "");
        assert.equal(fold(null), "");
        assert.equal(fold(42), "");
    });
});

describe("tidy", () => {
    it("collapses horizontal whitespace but keeps line breaks", () => {
        assert.equal(tidy("cần   mua\nlaptop  cũ"), "cần mua\nlaptop cũ");
    });

    it("collapses three or more newlines into a blank line", () => {
        assert.equal(tidy("a\n\n\n\nb"), "a\n\nb");
    });

    it("preserves diacritics and case", () => {
        assert.equal(tidy("Cần Mua Đồ"), "Cần Mua Đồ");
    });
});

describe("containsTerm", () => {
    it("matches a diacritic-free query against accented text", () => {
        assert.equal(containsTerm(fold("Mình cần mua laptop"), "can mua"), true);
    });

    it("matches an accented query against diacritic-free text", () => {
        assert.equal(containsTerm(fold("minh can mua laptop"), "cần mua"), true);
    });

    it("respects word boundaries", () => {
        // "an" must not match inside "banh".
        assert.equal(containsTerm(fold("bánh mì"), "an"), false);
        assert.equal(containsTerm(fold("ăn sáng"), "an"), true);
    });

    it("matches a term at the start and end of the text", () => {
        assert.equal(containsTerm(fold("laptop cũ"), "laptop"), true);
        assert.equal(containsTerm(fold("bán laptop"), "laptop"), true);
    });

    it("keeps scanning past a boundary-failed occurrence", () => {
        // First "mua" is inside "muay"; the standalone one later must still hit.
        assert.equal(containsTerm(fold("muay thai, cần mua vé"), "mua"), true);
    });

    it("returns false for empty needle or haystack", () => {
        assert.equal(containsTerm(fold("laptop"), ""), false);
        assert.equal(containsTerm("", "laptop"), false);
    });
});

describe("fingerprint", () => {
    it("is stable for the same content", () => {
        const post = { groupId: "1", text: "Cần mua laptop" };
        assert.equal(fingerprint(post), fingerprint({ ...post }));
    });

    it("ignores diacritics, case, and spacing differences", () => {
        assert.equal(
            fingerprint({ groupId: "1", text: "Cần mua laptop" }),
            fingerprint({ groupId: "1", text: "CAN   MUA LAPTOP" }),
        );
    });

    it("differs across groups for identical text", () => {
        assert.notEqual(
            fingerprint({ groupId: "1", text: "Cần mua laptop" }),
            fingerprint({ groupId: "2", text: "Cần mua laptop" }),
        );
    });

    it("differs for different text", () => {
        assert.notEqual(
            fingerprint({ groupId: "1", text: "Cần mua laptop" }),
            fingerprint({ groupId: "1", text: "Cần bán laptop" }),
        );
    });

    it("returns an 8-character hex string", () => {
        assert.match(fingerprint({ groupId: "1", text: "x" }), /^[0-9a-f]{8}$/);
    });
});
