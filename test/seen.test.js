import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { readJson } from "../src/store/io.js";
import { commitSeen, loadSeen, partitionBySeen } from "../src/store/seen.js";

describe("partitionBySeen", () => {
    it("passes through posts that were never reported", () => {
        const { fresh, duplicates } = partitionBySeen([{ id: "a" }, { id: "b" }], {});
        assert.equal(fresh.length, 2);
        assert.equal(duplicates.length, 0);
    });

    it("filters out posts recorded in a previous run", () => {
        const seen = { a: "2026-07-30T00:00:00.000Z" };
        const { fresh, duplicates } = partitionBySeen([{ id: "a" }, { id: "b" }], seen);
        assert.deepEqual(
            fresh.map((post) => post.id),
            ["b"],
        );
        assert.deepEqual(
            duplicates.map((post) => post.id),
            ["a"],
        );
    });

    it("collapses duplicates that appear twice within one batch", () => {
        const { fresh, duplicates } = partitionBySeen([{ id: "a" }, { id: "a" }], {});
        assert.equal(fresh.length, 1);
        assert.equal(duplicates.length, 1);
    });

    it("is not fooled by an id that collides with an Object.prototype key", () => {
        const { fresh } = partitionBySeen([{ id: "constructor" }, { id: "toString" }], {});
        assert.equal(fresh.length, 2);
    });
});

describe("commitSeen", () => {
    let dir;
    let path;

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), "fbdigest-"));
        path = join(dir, "seen.json");
    });

    after(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("records the ids of the posts it was given", async () => {
        const now = new Date("2026-07-31T00:00:00.000Z");
        await commitSeen(path, {}, [{ id: "a" }, { id: "b" }], { now });

        const written = await readJson(path);
        assert.deepEqual(Object.keys(written).sort(), ["a", "b"]);
        assert.equal(written.a, now.toISOString());
    });

    it("prunes entries older than the retention window", async () => {
        const now = new Date("2026-07-31T00:00:00.000Z");
        const seen = {
            old: "2026-05-01T00:00:00.000Z",
            recent: "2026-07-29T00:00:00.000Z",
        };

        const next = await commitSeen(path, seen, [{ id: "new" }], { retentionDays: 30, now });

        assert.ok(!Object.hasOwn(next, "old"));
        assert.ok(Object.hasOwn(next, "recent"));
        assert.ok(Object.hasOwn(next, "new"));
    });

    it("keeps entries whose timestamp cannot be parsed", async () => {
        const next = await commitSeen(path, { weird: "not-a-date" }, [], {
            now: new Date("2026-07-31T00:00:00.000Z"),
        });
        assert.ok(Object.hasOwn(next, "weird"));
    });

    it("round-trips through loadSeen", async () => {
        const now = new Date("2026-07-31T00:00:00.000Z");
        await commitSeen(path, {}, [{ id: "x" }], { now });
        assert.deepEqual(Object.keys(await loadSeen(path)), ["x"]);
    });

    it("returns an empty index when the file does not exist", async () => {
        assert.deepEqual(await loadSeen(join(dir, "missing.json")), {});
    });
});
