const helpWidgets = Array.from(document.querySelectorAll(".help")).map(help => {
    const button = help.querySelector(".help-button");
    const tooltipId = button?.getAttribute("aria-controls");
    const tooltip = tooltipId && document.getElementById(tooltipId);

    if (!button || !tooltip)
        throw new Error("Each .help widget must have a .help-button and its controlled tooltip.");

    const setOpen = open => {
        tooltip.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
    };

    button.addEventListener("click", () => setOpen(tooltip.hidden));

    return { help, button, tooltip, setOpen };
});

document.addEventListener("click", event => {
    for (const widget of helpWidgets)
        if (!widget.help.contains(event.target)) widget.setOpen(false);
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;

    for (const widget of helpWidgets) {
        if (widget.tooltip.hidden) continue;
        const restoreFocus = widget.help.contains(document.activeElement);
        widget.setOpen(false);
        if (restoreFocus) widget.button.focus();
    }
});
