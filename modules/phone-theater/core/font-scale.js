/**
 * Shared font-scale control for phone-theater scenes.
 * Stores the user's preferred font scale in localStorage and applies it
 * via a CSS custom property --phone-font-scale on the scene page element.
 */

const FONT_SCALE_STORAGE_KEY = 'koove-phone-font-scale';

const FONT_SCALES = Object.freeze([0.85, 1.0, 1.15, 1.3]);

const FONT_SCALE_LABELS = Object.freeze(['小', '中', '大', '超大']);

const CSS_VAR = '--phone-font-scale';

function getStoredFontScale() {
    try {
        const raw = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed) && FONT_SCALES.includes(parsed)) {
            return parsed;
        }
    } catch (_) { /* ignore */ }
    return 1.0;
}

function storeFontScale(scale) {
    try {
        localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(scale));
    } catch (_) { /* ignore */ }
}

function getNextFontScale(current) {
    const idx = FONT_SCALES.indexOf(current);
    if (idx < 0) return FONT_SCALES[1];
    return FONT_SCALES[(idx + 1) % FONT_SCALES.length];
}

function getLabelForScale(scale) {
    const idx = FONT_SCALES.indexOf(scale);
    return idx >= 0 ? FONT_SCALE_LABELS[idx] : '中';
}

function applyFontScaleToElement(el, scale) {
    if (!(el instanceof HTMLElement)) return;
    el.style.setProperty(CSS_VAR, String(scale));
    el.dataset.phoneFontScale = String(scale);
}

function syncAllVisiblePages(scale) {
    document.querySelectorAll('.phone-app-page.phone-theater-page').forEach((page) => {
        applyFontScaleToElement(page, scale);
    });
}

/**
 * Inject a font-size toggle button into the scene's nav-actions bar,
 * and apply the current stored scale on mount.
 *
 * Call this from each scene's bindInteractions.
 *
 * @param {HTMLElement} container - The scene page root (.phone-app-page.phone-theater-page)
 * @param {Object} context - Scene interaction context (addEventListener, etc.)
 */
export function bindFontScaleButton(container, context = {}) {
    const navActions = container.querySelector('.phone-theater-nav-actions');
    if (!(navActions instanceof HTMLElement)) return;

    const existing = navActions.querySelector('.phone-theater-font-scale-btn');
    if (existing) return; // already bound

    const currentScale = getStoredFontScale();
    applyFontScaleToElement(container, currentScale);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phone-theater-font-scale-btn';
    button.title = '字体大小';
    button.setAttribute('aria-label', '切换字体大小');
    button.textContent = getLabelForScale(currentScale);

    navActions.appendChild(button);

    const handleClick = () => {
        const scale = getStoredFontScale();
        const next = getNextFontScale(scale);
        storeFontScale(next);
        button.textContent = getLabelForScale(next);
        syncAllVisiblePages(next);
    };

    if (typeof context.addEventListener === 'function') {
        context.addEventListener(button, 'click', handleClick);
    } else {
        button.addEventListener('click', handleClick);
    }
}
