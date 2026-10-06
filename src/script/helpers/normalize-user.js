export const normalizeUser = user => {
    const temp = user.trim().replaceAll("_", " ").split(":").pop().trim();
    return `${temp.charAt(0).toUpperCase()}${temp.slice(1)}`;
};