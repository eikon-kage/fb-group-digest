/**
 * Keyword rule engine.
 *
 * A rule is a small boolean expression over a post's text:
 *
 *   {
 *     name:   "Cần mua laptop",
 *     all:    ["cần mua"],            // every term must appear
 *     any:    ["laptop", "macbook"],  // at least one must appear
 *     none:   ["đã mua"],             // none may appear
 *     regex:  ["\\b(i5|i7)\\b"],      // every pattern must match
 *     weight: 3                       // added to the post's score on a match
 *   }
 *
 * Every clause is optional. A rule with no clauses never matches — that is a
 * config mistake, not a wildcard.
 *
 * All term comparisons run against the folded text (see `normalize.fold`), so
 * "can mua" matches a post that says "cần mua" and vice versa. Regex patterns
 * are also tested against the folded text, which means they should be written
 * without diacritics.
 */

import { containsTerm, fold } from "./normalize.js";

/**
 * @typedef {object} Rule
 * @property {string} name
 * @property {string[]} [all]
 * @property {string[]} [any]
 * @property {string[]} [none]
 * @property {string[]} [regex]
 * @property {number} [weight]
 */

/**
 * @typedef {object} MatchResult
 * @property {number} score Sum of the weights of every rule that matched.
 * @property {string[]} rules Names of the rules that matched.
 * @property {string[]} hits Distinct terms that triggered a match, for highlighting.
 */

/**
 * Validate a rule set and pre-compile its regexes.
 *
 * Throws on a malformed rule rather than silently skipping it — a typo in the
 * config should not quietly shrink the report.
 *
 * @param {Rule[]} rules
 * @returns {Array<Rule & { compiled: RegExp[] }>}
 */
export function compileRules(rules) {
    if (!Array.isArray(rules)) throw new TypeError("rules must be an array");

    return rules.map((rule, index) => {
        if (!rule || typeof rule.name !== "string" || rule.name.trim() === "") {
            throw new TypeError(`rules[${index}] is missing a name`);
        }

        for (const clause of ["all", "any", "none", "regex"]) {
            const value = rule[clause];
            if (value === undefined) continue;
            if (!Array.isArray(value) || value.some((t) => typeof t !== "string")) {
                throw new TypeError(`rules[${index}] (${rule.name}): "${clause}" must be string[]`);
            }
        }

        const hasClause = ["all", "any", "none", "regex"].some(
            (clause) => Array.isArray(rule[clause]) && rule[clause].length > 0,
        );
        if (!hasClause) {
            throw new TypeError(
                `rules[${index}] (${rule.name}) has no clauses and can never match`,
            );
        }

        const compiled = (rule.regex ?? []).map((pattern) => {
            try {
                return new RegExp(pattern, "iu");
            } catch (cause) {
                throw new TypeError(`rules[${index}] (${rule.name}): invalid regex ${pattern}`, {
                    cause,
                });
            }
        });

        return { ...rule, weight: rule.weight ?? 1, compiled };
    });
}

/**
 * Score one piece of text against a compiled rule set.
 *
 * @param {string} text
 * @param {ReturnType<typeof compileRules>} compiledRules
 * @returns {MatchResult}
 */
export function scoreText(text, compiledRules) {
    const folded = fold(text);
    const result = { score: 0, rules: [], hits: [] };
    const hits = new Set();

    for (const rule of compiledRules) {
        const localHits = [];

        // `none` is checked first: a single exclusion disqualifies the rule and
        // saves the remaining work.
        if ((rule.none ?? []).some((term) => containsTerm(folded, term))) continue;

        let ok = true;

        for (const term of rule.all ?? []) {
            if (!containsTerm(folded, term)) {
                ok = false;
                break;
            }
            localHits.push(term);
        }
        if (!ok) continue;

        if (Array.isArray(rule.any) && rule.any.length > 0) {
            const found = rule.any.filter((term) => containsTerm(folded, term));
            if (found.length === 0) continue;
            localHits.push(...found);
        }

        for (const pattern of rule.compiled) {
            if (!pattern.test(folded)) {
                ok = false;
                break;
            }
        }
        if (!ok) continue;

        result.score += rule.weight;
        result.rules.push(rule.name);
        for (const hit of localHits) hits.add(hit);
    }

    result.hits = [...hits];
    return result;
}

/**
 * Filter and rank a batch of posts.
 *
 * @param {Array<{ text: string }>} posts
 * @param {Rule[]} rules
 * @param {{ minScore?: number }} [options]
 * @returns {Array<object>} Matching posts, highest score first, each annotated
 *   with `score`, `rules`, and `hits`.
 */
export function filterPosts(posts, rules, options = {}) {
    const minScore = options.minScore ?? 1;
    const compiled = compileRules(rules);

    return posts
        .map((post) => ({ ...post, ...scoreText(post.text, compiled) }))
        .filter((post) => post.score >= minScore)
        .sort((a, b) => b.score - a.score);
}
