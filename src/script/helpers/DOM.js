export const $ = (function(selector, $context = document) { return $context.querySelector(selector); });
export const $$ = (function(selector, $context = document) { return $context.querySelectorAll(selector); });

export const $Text = (function(text) { return document.createTextNode(text); })
export const $Create = (function(tag, attributes = { }, $$children = "", eventListeners = [ ], callback) {
    const $el = document.createElement(tag);
    for (const [ key, value ] of Object.entries(attributes)) {
        if (key === "className")
            $el.className = value;
        else if (key === "style") {
            if (typeof value === "string")
                $el.style.cssText = value;
            else if (value && typeof value === "object")
                for (const [ property, styleValue ] of Object.entries(value)) {
                    if (property.includes("-"))
                        $el.style.setProperty(property, styleValue);
                    else
                        $el.style[property] = styleValue;
                }
        } else if (key === "dataset") {
            if (value && typeof value === "object")
                Object.assign($el.dataset, value);
        } else if (key === "functions") {
            if (value && typeof value === "object")
                for (const [ key, fn ] of Object.entries(value))
                    $el[key] = fn;
        } else $el.setAttribute(key, value);
    }

    if (Array.isArray($$children))
        $$children.forEach($child => {
            if ($child) $el.appendChild($child);
        });
    else if (typeof $$children === "string" && $$children !== "")
        $el.textContent = $$children;

    if (Array.isArray(eventListeners))
        for (const args of eventListeners)
            $el.addEventListener(args[0], (...eArgs) => args[1]($el, ...eArgs), ...args.slice(2));

    if (typeof callback === "function")
        new Promise(resolve => {
            if ($el.isConnected)
                return resolve();

            const observer = new MutationObserver(() => {
                if ($el.isConnected) {
                    observer.disconnect();
                    resolve();
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
        }).then(() => callback($el));

    return $el;
});