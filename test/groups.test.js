/**
 * Nhận diện và gộp nhóm.
 *
 * Chỉ phần chạy trong Node: tách slug từ URL, gộp các lần nhìn thấy cùng một
 * nhóm, và trộn vào config. Phần đọc DOM cần trình duyệt nên không phủ ở đây.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { groupSlug, mergeConfigGroups, mergeSightings } from "../src/collect/groups.js";

test("groupSlug chỉ nhận đường dẫn gốc của nhóm", () => {
    assert.equal(groupSlug("https://www.facebook.com/groups/1270622383398741"), "1270622383398741");
    assert.equal(
        groupSlug("https://www.facebook.com/groups/vieclamit/?ref=bookmarks"),
        "vieclamit",
    );
    assert.equal(groupSlug("/groups/vieclamit/"), "vieclamit");

    assert.equal(groupSlug("https://www.facebook.com/groups/feed/"), null);
    assert.equal(groupSlug("https://www.facebook.com/groups/123/user/9"), null);
    assert.equal(groupSlug("https://www.facebook.com/watch"), null);
    assert.equal(groupSlug("không phải url"), null);
});

test("mergeSightings gộp theo slug và giữ tên đọc được đầy đủ nhất", () => {
    const groups = mergeSightings([
        { slug: "111", name: "" },
        { slug: "111", name: "Nhóm IT" },
        { slug: "111", name: "Nhóm" },
        { slug: "222", name: "Nhóm khác" },
    ]);

    assert.deepEqual(groups, [
        { id: "111", name: "Nhóm IT", url: "https://www.facebook.com/groups/111" },
        { id: "222", name: "Nhóm khác", url: "https://www.facebook.com/groups/222" },
    ]);
});

test("mergeConfigGroups chỉ thêm nhóm chưa có, kể cả khi config ghi bằng slug chữ", () => {
    const existing = [
        {
            id: "vieclamit",
            name: "Đã sửa tên bằng tay",
            url: "https://www.facebook.com/groups/vieclamit",
        },
    ];
    const found = [
        // Cùng nhóm với mục trên, nhưng lần quét này trả về id số.
        { id: "999", name: "Việc làm IT", url: "https://www.facebook.com/groups/vieclamit" },
        { id: "111", name: "Nhóm mới", url: "https://www.facebook.com/groups/111" },
    ];

    const { groups, added } = mergeConfigGroups(existing, found);

    assert.equal(added.length, 1);
    assert.equal(added[0].id, "111");
    assert.deepEqual(groups[0], existing[0]);
    assert.equal(groups.length, 2);
});
