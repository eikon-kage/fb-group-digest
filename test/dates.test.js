import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePostedAt } from "../src/filter/dates.js";

describe("parsePostedAt", () => {
    it("reads the en-GB label Facebook actually emits", () => {
        // Captured verbatim from a real group feed.
        const date = parsePostedAt("Friday 31 July 2026 at 03:38");
        assert.equal(date.getFullYear(), 2026);
        assert.equal(date.getMonth(), 6);
        assert.equal(date.getDate(), 31);
        assert.equal(date.getHours(), 3);
        assert.equal(date.getMinutes(), 38);
    });

    it("reads the en-US month-first label", () => {
        const date = parsePostedAt("July 31, 2026 at 11:05 PM");
        assert.equal(date.getMonth(), 6);
        assert.equal(date.getDate(), 31);
        assert.equal(date.getHours(), 11);
    });

    it("reads the Vietnamese label", () => {
        const date = parsePostedAt("Thứ Sáu, 31 tháng 7, 2026 lúc 03:38");
        assert.equal(date.getMonth(), 6);
        assert.equal(date.getDate(), 31);
        assert.equal(date.getHours(), 3);
    });

    it("accepts abbreviated month names", () => {
        assert.equal(parsePostedAt("2 Sept 2026 at 09:00").getMonth(), 8);
        assert.equal(parsePostedAt("2 Dec 2026 at 09:00").getMonth(), 11);
    });

    it("treats a date with no time as midnight", () => {
        const date = parsePostedAt("31 July 2026");
        assert.equal(date.getHours(), 0);
        assert.equal(date.getMinutes(), 0);
    });

    it("is not fooled by the weekday name in the label", () => {
        // "March" would match month-first if the weekday were mistaken for it.
        const date = parsePostedAt("Monday 3 August 2026 at 07:00");
        assert.equal(date.getMonth(), 7);
        assert.equal(date.getDate(), 3);
    });

    it("reads the relative label a post actually carries", () => {
        // This is the only label a group post exposes; the absolute form
        // belongs to comment anchors, not to the post.
        const now = new Date(2026, 7, 1, 12, 0);
        assert.equal(parsePostedAt("15h", now).getTime(), now.getTime() - 15 * 3_600_000);
        assert.equal(parsePostedAt("45m", now).getTime(), now.getTime() - 45 * 60_000);
        assert.equal(parsePostedAt("3d", now).getTime(), now.getTime() - 3 * 86_400_000);
        assert.equal(parsePostedAt("2w", now).getTime(), now.getTime() - 2 * 604_800_000);
    });

    it("reads Vietnamese relative labels", () => {
        const now = new Date(2026, 7, 1, 12, 0);
        assert.equal(parsePostedAt("2 giờ", now).getTime(), now.getTime() - 2 * 3_600_000);
        assert.equal(parsePostedAt("5 ngày", now).getTime(), now.getTime() - 5 * 86_400_000);
        assert.equal(parsePostedAt("1 tuần", now).getTime(), now.getTime() - 604_800_000);
        assert.equal(parsePostedAt("30 phút", now).getTime(), now.getTime() - 30 * 60_000);
    });

    it("treats 'just now' as the reference instant", () => {
        const now = new Date(2026, 7, 1, 12, 0);
        assert.equal(parsePostedAt("Just now", now).getTime(), now.getTime());
        assert.equal(parsePostedAt("Vừa xong", now).getTime(), now.getTime());
    });

    it("fills in the current year when the label omits it", () => {
        const now = new Date(2026, 7, 1, 12, 0);
        const date = parsePostedAt("31 July at 03:38", now);
        assert.equal(date.getFullYear(), 2026);
        assert.equal(date.getMonth(), 6);
        assert.equal(date.getDate(), 31);
    });

    it("returns null for a relative label with an unknown unit", () => {
        assert.equal(parsePostedAt("15 fortnights"), null);
        assert.equal(parsePostedAt("hôm qua"), null);
    });

    it("returns null rather than rolling an impossible date forward", () => {
        assert.equal(parsePostedAt("31 February 2026 at 10:00"), null);
    });

    it("returns null for a nonsense time", () => {
        assert.equal(parsePostedAt("31 July 2026 at 99:99"), null);
    });

    it("returns null for missing or non-string input", () => {
        assert.equal(parsePostedAt(null), null);
        assert.equal(parsePostedAt(undefined), null);
        assert.equal(parsePostedAt(""), null);
        assert.equal(parsePostedAt(12345), null);
    });
});
