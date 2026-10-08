export function AddArrayToArray(a, b) {
    const length = b.length;
    for (let i = 0; i < length; i++) a.push(b[i]);
}