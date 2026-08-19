import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addToHistory, recentHistory } from "../src/store/history.js";

const DAY = 24 * 60 * 60 * 1000;

describe("addToHistory", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");

    it("stamps this run's posts with the moment they were reported", () => {
        const history = addToHistory([], [{ id: "a", text: "một" }], { now });
        assert.equal(history.length, 1);
        assert.equal(history[0].reportedAt, now.toISOString());
        assert.equal(history[0].text, "một");
    });

    it("keeps the original date when a post is reported again", () => {
        const old = [{ id: "a", text: "một", reportedAt: "2026-08-17T09:00:00.000Z" }];
        const history = addToHistory(old, [], { now });
        assert.equal(history[0].reportedAt, "2026-08-17T09:00:00.000Z");
    });

    it("does not store the same post twice", () => {
        const old = [{ id: "a", text: "cũ", reportedAt: "2026-08-18T09:00:00.000Z" }];
        const history = addToHistory(old, [{ id: "a", text: "mới" }], { now });
        assert.equal(history.length, 1);
        // This run's copy wins: a post whose text grew is worth updating, but
        // the date it was first reported is not.
        assert.equal(history[0].text, "mới");
        assert.equal(history[0].reportedAt, now.toISOString());
    });

    it("recognises the same post under a changed fingerprint", () => {
        const old = [
            {
                id: "cũ",
                permalink: "https://facebook.com/groups/g/posts/77",
                reportedAt: "2026-08-18T09:00:00.000Z",
            },
        ];
        const history = addToHistory(
            old,
            [{ id: "dài-hơn", permalink: "https://facebook.com/groups/g/posts/77" }],
            { now },
        );
        assert.equal(history.length, 1);
    });

    it("drops entries past the retention window", () => {
        const old = [
            { id: "a", reportedAt: new Date(now.getTime() - 10 * DAY).toISOString() },
            { id: "b", reportedAt: new Date(now.getTime() - 40 * DAY).toISOString() },
        ];
        const history = addToHistory(old, [], { now, retentionDays: 30 });
        assert.deepEqual(
            history.map((post) => post.id),
            ["a"],
        );
    });

    it("drops an entry with no usable date rather than keeping it forever", () => {
        const history = addToHistory([{ id: "a", reportedAt: "hôm nọ" }], [], { now });
        assert.equal(history.length, 0);
    });
});

describe("recentHistory", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const history = [
        { id: "a", reportedAt: new Date(now.getTime() - 2 * DAY).toISOString() },
        { id: "b", reportedAt: new Date(now.getTime() - 9 * DAY).toISOString() },
    ];

    it("returns the entries inside the window, marked as carried over", () => {
        const previous = recentHistory(history, [], { days: 7, now });
        assert.deepEqual(
            previous.map((post) => post.id),
            ["a"],
        );
        assert.equal(previous[0].previous, true);
    });

    it("leaves out posts this run is already reporting", () => {
        assert.deepEqual(recentHistory(history, [{ id: "a" }], { days: 7, now }), []);
    });

    it("returns nothing when the window is switched off", () => {
        assert.deepEqual(recentHistory(history, [], { days: 0, now }), []);
    });
});
