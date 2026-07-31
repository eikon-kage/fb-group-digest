/**
 * Claude analysis layer.
 *
 * Two passes:
 *   1. `classifyPosts` — cheap, structured, per-post. Runs at low effort
 *      because it is extraction, not reasoning.
 *   2. `buildDigest` — one high-effort synthesis pass over the classified set,
 *      producing the prose that opens the report.
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
import { log } from "../logger.js";

const BATCH_SIZE = 15;

const CATEGORIES = [
    "cần mua",
    "cần bán",
    "tuyển dụng",
    "tìm việc",
    "hỏi đáp",
    "review",
    "thông báo",
    "khác",
];

const CLASSIFY_SCHEMA = {
    type: "object",
    properties: {
        results: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    index: {
                        type: "integer",
                        description: "Số thứ tự của bài đăng trong danh sách đầu vào",
                    },
                    category: { type: "string", enum: CATEGORIES },
                    urgency: { type: "string", enum: ["cao", "trung bình", "thấp"] },
                    summary: {
                        type: "string",
                        description: "Tóm tắt bài đăng trong một câu tiếng Việt",
                    },
                    entities: {
                        type: "array",
                        items: { type: "string" },
                        description: "Sản phẩm, công nghệ, địa điểm, mức giá được nhắc tới",
                    },
                },
                required: ["index", "category", "urgency", "summary", "entities"],
                additionalProperties: false,
            },
        },
    },
    required: ["results"],
    additionalProperties: false,
};

const CLASSIFY_SYSTEM = `Bạn phân loại bài đăng từ các nhóm Facebook tiếng Việt.

Với mỗi bài đăng, xác định:
- category: loại bài đăng
- urgency: mức độ gấp mà người đăng thể hiện ("gấp", "cần luôn" → cao)
- summary: một câu tiếng Việt, tối đa 25 từ, nêu đúng nội dung chính
- entities: sản phẩm, công nghệ, địa điểm, mức giá cụ thể xuất hiện trong bài

Chỉ dựa vào nội dung bài đăng. Không suy đoán thông tin không có trong text.
Không nhắc tới hay suy đoán danh tính người đăng.
Trả về đúng một phần tử cho mỗi bài đăng, giữ nguyên index đầu vào.`;

/** @returns {Anthropic} */
function client() {
    // A bare constructor resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
    // `ant auth login` profile — so an unset env var is not necessarily an error.
    return new Anthropic();
}

/**
 * @param {Array<object>} items
 * @param {number} size
 * @returns {Array<Array<object>>}
 */
function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * Classify posts in batches, annotating each with `analysis`.
 *
 * A batch that fails is logged and skipped rather than aborting the run — a
 * partial digest beats no digest.
 *
 * @param {Array<{ text: string }>} posts
 * @returns {Promise<Array<object>>}
 */
export async function classifyPosts(posts) {
    if (posts.length === 0) return [];

    const anthropic = client();
    const model = env("CLAUDE_MODEL", "claude-opus-5");
    const effort = env("CLAUDE_CLASSIFY_EFFORT", "low");
    const batches = chunk(posts, BATCH_SIZE);
    const annotated = [...posts];

    for (const [batchIndex, batch] of batches.entries()) {
        log.info(`Phân tích lô ${batchIndex + 1}/${batches.length} (${batch.length} bài)…`);

        const numbered = batch
            .map((post, i) => `### Bài ${i}\nNhóm: ${post.groupName}\n---\n${post.text}`)
            .join("\n\n");

        try {
            const response = await anthropic.messages.create({
                model,
                max_tokens: 16000,
                system: CLASSIFY_SYSTEM,
                output_config: {
                    effort,
                    format: { type: "json_schema", schema: CLASSIFY_SCHEMA },
                },
                messages: [{ role: "user", content: numbered }],
            });

            if (response.stop_reason === "refusal") {
                log.warn(`Lô ${batchIndex + 1} bị từ chối (${response.stop_details?.category}).`);
                continue;
            }

            const textBlock = response.content.find((block) => block.type === "text");
            if (!textBlock) {
                log.warn(`Lô ${batchIndex + 1} không trả về text.`);
                continue;
            }

            const { results } = JSON.parse(textBlock.text);
            for (const result of results) {
                const target = batch[result.index];
                if (!target) continue;
                const position = posts.indexOf(target);
                annotated[position] = { ...target, analysis: result };
            }
        } catch (error) {
            log.warn(`Lô ${batchIndex + 1} lỗi: ${error.message}`);
        }
    }

    return annotated;
}

/**
 * Write the executive summary that opens the report.
 *
 * @param {Array<object>} posts Already classified.
 * @returns {Promise<string>} Markdown.
 */
export async function buildDigest(posts) {
    if (posts.length === 0) return "Không có bài đăng nào khớp bộ lọc trong lần chạy này.";

    const anthropic = client();
    const model = env("CLAUDE_MODEL", "claude-opus-5");
    const effort = env("CLAUDE_DIGEST_EFFORT", "high");

    const lines = posts.map((post, i) => {
        const analysis = post.analysis ?? {};
        return [
            `${i + 1}. [${post.groupName}] (${analysis.category ?? "?"}, gấp: ${analysis.urgency ?? "?"})`,
            `   ${analysis.summary ?? post.text.slice(0, 160)}`,
            analysis.entities?.length ? `   Từ khoá: ${analysis.entities.join(", ")}` : null,
        ]
            .filter(Boolean)
            .join("\n");
    });

    const prompt = `Dưới đây là ${posts.length} bài đăng đã lọc từ các nhóm Facebook hôm nay.

${lines.join("\n")}

Viết một bản tóm tắt tiếng Việt bằng Markdown, gồm:
1. Một đoạn 2-3 câu nêu bức tranh chung của hôm nay.
2. Mục "## Đáng chú ý" — tối đa 5 gạch đầu dòng cho những bài quan trọng nhất, mỗi dòng ghi rõ số thứ tự bài để đối chiếu.
3. Mục "## Xu hướng" — các chủ đề lặp lại giữa nhiều bài, nếu có.

Bám sát dữ liệu ở trên, không bịa thêm. Nếu dữ liệu quá ít để nói về xu hướng, nói thẳng như vậy.`;

    const stream = anthropic.messages.stream({
        model,
        max_tokens: 8000,
        output_config: { effort },
        messages: [{ role: "user", content: prompt }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
        log.warn("Phần tóm tắt bị từ chối, báo cáo vẫn có đầy đủ danh sách bài.");
        return "_Không tạo được phần tóm tắt cho lần chạy này._";
    }

    return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
}
