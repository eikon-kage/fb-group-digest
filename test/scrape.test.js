/**
 * Incremental-walk logic.
 *
 * Everything here is the Node half of the collector — the part that decides
 * when a group's feed has been walked far enough. The DOM half needs a browser
 * and is not covered.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { atSeenBoundary, mergeWindow } from "../src/collect/scrape.js";
import { seenKeys } from "../src/store/seen.js";

const GROUP = { id: "g1", name: "Nhóm test", url: "https://www.facebook.com/groups/g1" };

/** A raw post as `extractPosts` would return it. Text is padded past the 20-char floor. */
function raw(text, permalink = null) {
    return { text: `${text} — nội dung đủ dài để không bị bỏ`, permalink, timeLabel: null };
}

/** Run one window through `mergeWindow` with a fresh accumulator. */
function walk(rawPosts, seen = {}) {
    const collected = new Map();
    const alreadySeen = new Set();
    const result = mergeWindow(rawPosts, { group: GROUP, seen, collected, alreadySeen });
    return { ...result, collected, alreadySeen };
}

/** The seen index an earlier run would have left for these posts. */
function seenIndex(rawPosts) {
    const stamp = "2026-08-10T00:00:00.000Z";
    const index = {};
    for (const { collected } of [walk(rawPosts)]) {
        for (const post of collected.values()) {
            for (const key of seenKeys(post)) index[key] = stamp;
        }
    }
    return index;
}

test("mergeWindow keeps unreported posts and skips reported ones", () => {
    const old = [raw("bài cũ 1"), raw("bài cũ 2")];
    const seen = seenIndex(old);

    const { collected, alreadySeen, eligible } = walk([raw("bài mới"), ...old], seen);

    assert.equal(collected.size, 1);
    assert.equal([...collected.values()][0].text.startsWith("bài mới"), true);
    assert.equal(alreadySeen.size, 2);
    assert.equal(eligible, 3);
});

test("mergeWindow ignores posts under the length floor", () => {
    const { eligible, collected } = walk([{ text: "ok", permalink: null, timeLabel: null }]);

    assert.equal(eligible, 0);
    assert.equal(collected.size, 0);
});

test("tailSeen counts only the run of reported posts at the bottom", () => {
    const old = [raw("cũ 1"), raw("cũ 2"), raw("cũ 3")];
    const seen = seenIndex(old);

    // pinned(old) → new → old → old → old: the pinned post at the top must not
    // add to the count, or one sticky post would end the walk immediately.
    const { tailSeen } = walk([old[0], raw("bài mới"), ...old], seen);

    assert.equal(tailSeen, 3);
});

test("tailSeen resets on a post that is new again further down", () => {
    const old = [raw("cũ 1"), raw("cũ 2")];
    const seen = seenIndex(old);

    const { tailSeen } = walk([...old, raw("bài mới")], seen);

    assert.equal(tailSeen, 0);
});

test("a post already collected this run still resets tailSeen", () => {
    // It is unreported, so it is news — it just arrived in an earlier window.
    const old = [raw("cũ 1")];
    const seen = seenIndex(old);
    const collected = new Map();
    const alreadySeen = new Set();
    const fresh = raw("bài mới");
    const context = { group: GROUP, seen, collected, alreadySeen };

    mergeWindow([fresh], context);
    const second = mergeWindow([fresh, ...old], context);

    assert.equal(collected.size, 1, "the repeat must not be stored twice");
    assert.equal(second.tailSeen, 1);
});

test("mergeWindow fills in a permalink that arrived on a later window", () => {
    const collected = new Map();
    const context = { group: GROUP, seen: {}, collected, alreadySeen: new Set() };
    const text = "bài chưa hover được timestamp";

    mergeWindow([raw(text)], context);
    mergeWindow([raw(text, "/groups/g1/posts/123/")], context);

    const posts = [...collected.values()];
    assert.equal(posts.length, 1);
    assert.equal(posts[0].permalink, "https://www.facebook.com/groups/g1/posts/123/");
});

test("atSeenBoundary stops once the run of reported posts is deep enough", () => {
    const options = { streak: 5, scrolled: true };

    assert.equal(atSeenBoundary({ eligible: 12, tailSeen: 5 }, options), true);
    assert.equal(atSeenBoundary({ eligible: 12, tailSeen: 4 }, options), false);
});

test("atSeenBoundary keeps walking while the window still holds news", () => {
    assert.equal(
        atSeenBoundary({ eligible: 10, tailSeen: 0 }, { streak: 5, scrolled: true }),
        false,
    );
});

test("atSeenBoundary stops on an all-reported window shorter than the streak", () => {
    // A group with three posts total can never build a run of five.
    const shallow = { eligible: 3, tailSeen: 3 };

    assert.equal(atSeenBoundary(shallow, { streak: 5, scrolled: true }), true);
    assert.equal(
        atSeenBoundary(shallow, { streak: 5, scrolled: false }),
        false,
        "the first window can be one half-loaded card",
    );
});

test("atSeenBoundary never stops when the check is switched off", () => {
    assert.equal(
        atSeenBoundary({ eligible: 20, tailSeen: 20 }, { streak: 0, scrolled: true }),
        false,
    );
});
