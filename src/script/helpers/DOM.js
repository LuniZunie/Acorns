const $ = (selector, $context = document) => $context.querySelector(selector);
const $$ = (selector, $context = document) => $context.querySelectorAll(selector);

function $Create(tag, attributes = { }, $$children = "", eventListeners = [ ], callback) {
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
                for (const key of value)
                    $el[key] = value[key];
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

    if (typeof callback === "function") callback($el);

    return $el;
}

function $Text(text) {
    return document.createTextNode(text);
}

export { $, $$, $Create, $Text };