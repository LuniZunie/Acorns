import { $, $$ } from "../helpers/DOM.js";

const $$widgets = Array.from($$(".help")).map($help => {
    const $button = $(".help-button", $help);

    const id = $button?.getAttribute("aria-controls");
    const $tooltip = id && $(`#${id}`);

    if (!$button || !$tooltip)
        throw new Error("Each .help widget must have a .help-button and its controlled tooltip.");

    const setOpen = open => {
        $tooltip.classList.toggle("hidden", !open);
        $button.setAttribute("aria-expanded", String(open));
    };

    $button.addEventListener("click", () => setOpen($tooltip.classList.contains("hidden")));

    return { help: $help, button: $button, tooltip: $tooltip, setOpen };
});

document.addEventListener("click", event => {
    for (const $widget of $$widgets)
        if (!$widget.help.contains(event.target))
            $widget.setOpen(false);
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    for (const $widget of $$widgets) {
        if ($widget.tooltip.classList.contains("hidden")) continue;

        const restoreFocus = $widget.help.contains(document.activeElement);
        $widget.setOpen(false);

        if (restoreFocus) $widget.button.focus();
    }
});
