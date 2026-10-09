export const AddArrayToArray = (function(a, b) {
    const len = b.length;
    for (let i = 0; i < len; i++) a.push(b[i]);
});

export const BatchArray = (function*(items, size) {
    const len = items.length;
    for (let i = 0; i < len; i += size)
        yield items.slice(i, i + size);
});