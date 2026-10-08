import { GetUserColorSeed, UserColor } from "./username-to-color.js";

const CANDIDATE_COUNT = 100;

function getPaletteDistance(users, seed) {
    const hues = users.map(({ name }) => {
        const match = UserColor(name, seed).match(/^hsl\((\d+)/);
        if (!match) throw new Error(`Could not read generated color for "${name}".`);
        return Number(match[1]);
    });

    let minimumDistance = Infinity;
    for (let i = 0; i < hues.length; i++)
        for (let j = i + 1; j < hues.length; j++) {
            const difference = Math.abs(hues[i] - hues[j]);
            minimumDistance = Math.min(minimumDistance, difference, 360 - difference);
        }

    return minimumDistance;
}

export function PickColorSeed(users) {
    const currentSeed = GetUserColorSeed();
    const candidates = new Set();
    while (candidates.size < CANDIDATE_COUNT) {
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        if (seed !== currentSeed) candidates.add(seed);
    }

    let best;
    let greatestDistance = -Infinity;
    for (const candidate of candidates) {
        const distance = getPaletteDistance(users, candidate);
        if (distance > greatestDistance) {
            best = candidate;
            greatestDistance = distance;
        }
    }
    return best;
}