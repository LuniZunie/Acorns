import { $Create } from "./DOM.js";

const TEXT_COLOR = "#35423a";
export const CreateChart = (function(config, height = "16rem") {
    const $canvas = $Create("canvas");
    let chart = null;

    return $Create(
        "div",
        { className: "links-chart", style: { height } },
        [ $canvas ],
        [ ],
        () => {
            chart = new Chart($canvas, {
                ...config,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 0 },
                    transitions: { active: { animation: { duration: 200 } } },
                    color: TEXT_COLOR,
                    font: { family: getComputedStyle(document.body).fontFamily },
                    ...config.options
                }
            });

            const observer = new MutationObserver(() => {
                if ($canvas.isConnected) return;
                observer.disconnect();
                chart.destroy();
                chart = null;
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    );
});
