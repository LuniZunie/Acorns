export const Ratio = ((a, b) => b === 0 ? 0 : a / b);

export const Sum = (values => {
    let temp = values[0] | 0;
    const length = values.length;
    for (let i = 1; i < length; i++)
        temp += values[i];
    return temp;
});
export const Product = (values => {
    const length = values.length;
    if (length === 0) return 1;

    let temp = 1 * values[0];
    for (let i = 1; i < length; i++)
        temp *= values[i];
    return temp;
});
export const Weight = (values => {
    const length = values.length;
    if (length === 0) return [ ];

    let sum = values[0];
    for (let i = 1; i < length; i++)
        sum += values[i];

    const temp = [ values[0] / sum ];
    for (let i = 1; i < length; i++)
        temp.push(values[i] / sum);
    return temp;
});

export const Mean = (values => {
    const length = values.length;
    if (length === 0) return;

    let temp = values[0];
    for (let i = 1; i < length; i++)
        temp += values[i];
    return temp / length;
});
export const Median = (values => {
    const length = values.length;
    if (length === 0) return;
    else if (length % 2 === 0) {
        const half = length / 2;
        return (values[half] + values[half - 1]) / 2;
    } else return values[(length - 1) / 2]
});
export const Mode = (values => {
    const length = values.length;
    if (length === 0) return [ ];

    let max = 0;
    const counts = new Map(), best = [ ];
    for (let i = 0; i < length; i++) {
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