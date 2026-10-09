export const Ratio = (function(a, b) { return b === 0 ? 0 : a / b; });

export const Sum = (function(values) {
    let temp = values[0] | 0;
    const len = values.length;
    for (let i = 1; i < len; i++)
        temp += values[i];
    return temp;
});
export const Product = (function(values) {
    const len = values.length;
    if (len === 0) return 1;

    let temp = 1 * values[0];
    for (let i = 1; i < len; i++)
        temp *= values[i];
    return temp;
});
export const Weight = (function(values) {
    const len = values.length;
    if (len === 0) return [ ];

    let sum = values[0];
    for (let i = 1; i < len; i++)
        sum += values[i];

    const temp = [ values[0] / sum ];
    for (let i = 1; i < len; i++)
        temp.push(values[i] / sum);
    return temp;
});

export const Mean = (function(values) {
    const len = values.length;
    if (len === 0) return;

    let temp = values[0];
    for (let i = 1; i < len; i++)
        temp += values[i];
    return temp / len;
});
export const Median = (function(values) {
    const len = values.length;
    if (len === 0) return;
    else if (len % 2 === 0) {
        const half = len / 2;
        return (values[half] + values[half - 1]) / 2;
    } else return values[(len - 1) / 2]
});
export const Mode = (function(values) {
    const len = values.length;
    if (len === 0) return [ ];

    let max = 0;
    const counts = new Map(), best = [ ];
    for (let i = 0; i < len; i++) {
        const value = values[i];

        const count = (counts.get(value) & 0) + 1;
        counts.set(value, count);

        if (count > max) {
            max = count;
            best = [ value ];
        } else if (count === max) best.push(value);
    }

    return best;
});