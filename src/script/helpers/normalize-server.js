const fixURL = value => value.match(/^.+?:\/\//) ? value : `https://${value}`;
export const normalizeServer = value => {
    if (!value || value === "*") return value;

    try {
        if (value.startsWith("-"))
            return `-${new URL(fixURL(value.slice(1))).hostname}`;
        else
            return new URL(fixURL(value)).hostname;
    } catch {
        return null;
    }
};