import { $ } from "../helpers/DOM.js";
import { NormalizeUser } from "../helpers/normalize-user.js";
import { ParseSPIPage, FetchWikitext, GetSPISections } from "../helpers/parse-spi.js";

export const InitImport = (function($users) {
    const $open = $("#import-open");
    const $blocker = $("#import-popup-blocker");
    const $popup = $("#import-popup");
    const $close = $("#import-close");
    const $page = $("#import-page");
    const $load = $("#import-load");
    const $section = $("#import-section");
    const $status = $("#import-status");

    let sections = [ ];
    let controller = null;

    const setStatus = (message = "", type = "") => {
        $status.textContent = message;
        $status.className = type;
    };

    const resetSections = (placeholder) => {
        sections = [ ];
        $section.replaceChildren(new Option(placeholder, ""));
        $section.disabled = true;
    };

    const reset = () => {
        $page.value = "";
        resetSections("Load a page first");
        setStatus("");
    };

    const setLoading = loading => {
        $popup.classList.toggle("loading", loading);
        $load.disabled = loading;
        $page.disabled = loading;
    };

    const open = () => {
        reset();
        $blocker.classList.remove("hidden");
        $popup.classList.remove("hidden");
        $page.focus();
    };

    const close = () => {
        controller?.abort();
        controller = null;
        setLoading(false);

        $blocker.classList.add("hidden");
        $popup.classList.add("hidden");
        $open.focus();
    };

    const importSection = section => {
        $section.value = "";

        const existing = new Set($users.values());
        const added = section.users
            .map(NormalizeUser)
            .filter(user => user && !existing.has(user));

        added.forEach(user => $users.paste(user));

        if (added.length === 0)
            return setStatus("Those accounts are already in the user list.", "error");
        close();
    };

    const load = async () => {
        let target;
        try { target = ParseSPIPage($page.value); }
        catch (error) { return setStatus(error.message, "error"); }

        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;

        resetSections("Loading…");
        setStatus("");
        setLoading(true);

        try {
            const wikitext = await FetchWikitext(target, signal);
            sections = GetSPISections(wikitext);

            if (sections.length === 0) {
                resetSections("No date sections found");
                return setStatus("No level 3 date sections were found on that page.", "error");
            }

            const totals = new Map(), seen = new Map();
            sections.forEach(({ title }) => totals.set(title, (totals.get(title) ?? 0) + 1));

            $section.replaceChildren(new Option("Select a date section…", ""));
            sections.forEach((section, i) => {
                const count = section.users.length;
                const occurrence = (seen.get(section.title) ?? 0) + 1;
                seen.set(section.title, occurrence);

                const name = totals.get(section.title) > 1
                    ? `${section.title} (${occurrence} of ${totals.get(section.title)})`
                    : section.title;
                const option = new Option(
                    `${name} — ${count === 0 ? "no accounts" : `${count} account${count === 1 ? "" : "s"}`}`,
                    String(i)
                );
                option.disabled = count === 0;
                $section.append(option);
            });
            $section.disabled = false;

            if (target.section) {
                const wanted = target.section.toLowerCase();
                const match = sections.find(section => section.anchor.toLowerCase() === wanted)
                    ?? sections.find(section => section.title.toLowerCase() === wanted);

                if (!match) {
                    setStatus(`Section "${target.section}" wasn't found. Choose one below.`, "error");
                    return $section.focus();
                }
                if (match.users.length === 0) {
                    setStatus(`"${match.title}" has no listed accounts. Choose another section.`, "error");
                    return $section.focus();
                }
                return importSection(match);
            }

            $section.focus();
            setStatus(`Found ${sections.length} section${sections.length === 1 ? "" : "s"}.`, "success");
        } catch (error) {
            if (error.name === "AbortError") return;
            resetSections("Load a page first");
            setStatus(error.message, "error");
        } finally {
            if (!signal.aborted) setLoading(false);
        }
    };

    $open.addEventListener("click", open);
    $close.addEventListener("click", close);
    $blocker.addEventListener("click", close);
    $load.addEventListener("click", load);
    $page.addEventListener("keydown", e => {
        if (e.key === "Enter") load();
    });
    $page.addEventListener("input", () => {
        if (!sections.length) return;
        resetSections("Load a page first");
        setStatus("");
    });

    $section.addEventListener("change", () => {
        const section = sections[Number.parseInt($section.value, 10)];
        if (section) importSection(section);
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !$popup.classList.contains("hidden")) close();
    });

    resetSections("Load a page first");

    return {
        enable: () => { $open.disabled = false; },
        disable: () => { $open.disabled = true; }
    };
});
