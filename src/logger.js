/** Tiny console logger. Timestamps make an unattended cron run readable. */

const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
    /** @param {...unknown} args */
    info: (...args) => console.log(`[${stamp()}]`, ...args),
    /** @param {...unknown} args */
    warn: (...args) => console.warn(`[${stamp()}] ⚠`, ...args),
    /** @param {...unknown} args */
    error: (...args) => console.error(`[${stamp()}] ✖`, ...args),
    /** @param {...unknown} args */
    step: (...args) => console.log(`\n[${stamp()}] ▸`, ...args),
};

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
