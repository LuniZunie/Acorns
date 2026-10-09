import { $ } from "../helpers/DOM.js";

const $share = $("#share-button");
const $copied = $("#share-copied-tooltip");
let hideCopiedTooltipTimeout;

$share.addEventListener("click", async () => {
    const state = history.state ?? { };
    const url = new URL(`${window.location.origin}${window.location.pathname}`);

    if ("users" in state) url.searchParams.set("users", state.users.join(","));
    if ("projects" in state) url.searchParams.set("projects", state.projects.join(","));
    if ("tab" in state) url.searchParams.set("tab", state.tab);
    if ("data" in state) url.searchParams.set("data", state.data);
    if ("seed" in state) url.searchParams.set("seed", state.seed);
    if ("submit" in state) url.searchParams.set("submit", +state.submit);

    try {
        await navigator.clipboard.writeText(url.toString());
    } catch (error) {
        return console.error("Failed to copy share text to the clipboard.", error);
    }

    clearTimeout(hideCopiedTooltipTimeout);
    $copied.setAttribute("aria-hidden", "false");
    $copied.classList.add("visible");
    hideCopiedTooltipTimeout = setTimeout(() => {
        $copied.classList.remove("visible");
        $copied.setAttribute("aria-hidden", "true");
    }, 3000);
});
