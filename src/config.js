/** Configuration loading: `.env`, then the group/rule config file. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

/**
 * Minimal .env reader. Values already present in the real environment win, so
 * `SMTP_PASS=... npm run send` overrides the file.
 *
 * @param {string} [path]
 */
export async function loadEnv(path = ".env") {
    let raw;
    try {
        raw = await readFile(resolve(path), "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
    }

    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;

        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;

        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
export function env(name, fallback = "") {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function envInt(name, fallback) {
    const parsed = Number.parseInt(env(name, ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function envBool(name, fallback) {
    const value = env(name, "").toLowerCase();
    if (value === "") return fallback;
    return value === "1" || value === "true" || value === "yes";
}

/**
 * Load and validate the groups + rules config.
 *
 * @param {string} path
 * @returns {Promise<{ groups: object[], rules: object[], exclude: object[], minScore: number }>}
 */
export async function loadConfig(path) {
    const resolved = resolve(path);
    let parsed;
    try {
        parsed = JSON.parse(await readFile(resolved, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(
                `Không tìm thấy config: ${resolved}\n` +
                    `Copy config/groups.example.json thành config/groups.json rồi sửa lại.`,
            );
        }
        throw new Error(`Config không hợp lệ (${resolved}): ${error.message}`, { cause: error });
    }

    if (!Array.isArray(parsed.groups) || parsed.groups.length === 0) {
        throw new Error(`Config ${resolved}: "groups" phải là mảng và không được rỗng`);
    }
    for (const [index, group] of parsed.groups.entries()) {
        if (typeof group?.url !== "string" || !group.url.startsWith("http")) {
            throw new Error(`Config ${resolved}: groups[${index}].url thiếu hoặc sai định dạng`);
        }
    }
    if (!Array.isArray(parsed.rules)) {
        throw new Error(`Config ${resolved}: "rules" phải là mảng`);
    }
    if (parsed.exclude !== undefined && !Array.isArray(parsed.exclude)) {
        throw new Error(`Config ${resolved}: "exclude" phải là mảng`);
    }

    return {
        groups: parsed.groups,
        rules: parsed.rules,
        exclude: parsed.exclude ?? [],
        minScore: typeof parsed.minScore === "number" ? parsed.minScore : 1,
    };
}
