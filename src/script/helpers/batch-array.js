export function* BatchArray(items, batchSize) {
    const length = items.length;
    for (let i = 0; i < length; i += batchSize)
        yield items.slice(i, i + batchSize);
}