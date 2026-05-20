import {
    formatDateKey,
    formatDateLabel,
    getDateWithOffset,
    parseDateText,
} from '../../phone-core/date-relation.js';
import { escapeHtml, escapeHtmlAttr } from '../../utils/dom-escape.js';
import { getCellByHeader, mapTheaterRows, normalizeText } from '../core/table-index.js';

const CALENDAR_TABLES = Object.freeze({
    days: '小日历表',
});

const WEEKDAY_HEADINGS = Object.freeze(['一', '二', '三', '四', '五', '六', '日']);
const RELATION_ORDER = Object.freeze(['3天前', '前天', '昨天', '今天', '明天', '后天', '3天后']);
const FALLBACK_ANCHOR = Object.freeze({ year: 2026, monthIndex: 0, day: 1 });
const SELECTED_DATE_ATTR = 'data-calendar-selected-key';
const YEAR_PICKER_RANGE = 50;

function buildMonthGrid(year, monthIndex, startOfWeek = 1) {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const days = [];

    let firstDayIndex = firstDay.getDay() - startOfWeek;
    if (firstDayIndex < 0) firstDayIndex += 7;

    for (let index = firstDayIndex; index > 0; index -= 1) {
        const date = new Date(year, monthIndex, -index + 1);
        days.push({
            key: formatDateKey(date.getFullYear(), date.getMonth(), date.getDate()),
            label: formatDateLabel(date.getFullYear(), date.getMonth(), date.getDate()),
            day: date.getDate(),
            year: date.getFullYear(),
            monthIndex: date.getMonth(),
            inCurrentMonth: false,
        });
    }

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
        days.push({
            key: formatDateKey(year, monthIndex, day),
            label: formatDateLabel(year, monthIndex, day),
            day,
            year,
            monthIndex,
            inCurrentMonth: true,
        });
    }

    let lastDayIndex = lastDay.getDay() - startOfWeek;
    if (lastDayIndex < 0) lastDayIndex += 7;

    for (let index = 1; index < 7 - lastDayIndex; index += 1) {
        const date = new Date(year, monthIndex + 1, index);
        days.push({
            key: formatDateKey(date.getFullYear(), date.getMonth(), date.getDate()),
            label: formatDateLabel(date.getFullYear(), date.getMonth(), date.getDate()),
            day: date.getDate(),
            year: date.getFullYear(),
            monthIndex: date.getMonth(),
            inCurrentMonth: false,
        });
    }

    return days;
}

function normalizeCalendarRow(daysTable, row, rowIndex) {
    const dateText = normalizeText(getCellByHeader(daysTable, row, '日期'));
    const monthDays = normalizeText(getCellByHeader(daysTable, row, '月份几天'));
    const parsedDate = parseDateText(dateText, monthDays);
    const relation = normalizeText(getCellByHeader(daysTable, row, '与今天的关系'));
    return {
        rowIndex,
        dateText,
        parsedDate,
        weekdayText: normalizeText(getCellByHeader(daysTable, row, '星期几')),
        festivalText: normalizeText(getCellByHeader(daysTable, row, '节日')),
        majorEvent: normalizeText(getCellByHeader(daysTable, row, '大事件')),
        dayStatus: normalizeText(getCellByHeader(daysTable, row, '状态')),
        weatherText: normalizeText(getCellByHeader(daysTable, row, '天气')),
        todayRelation: relation,
        dayContent: normalizeText(getCellByHeader(daysTable, row, '内容')),
        monthDays,
    };
}

function resolveAnchorRow(rows = []) {
    return rows.find(row => row.todayRelation === '今天' && row.parsedDate)
        || rows.find(row => row.parsedDate)
        || null;
}

function buildContentByDateKey(rows = [], anchorRow) {
    const contentByDateKey = new Map();
    rows.forEach((row) => {
        const relationIndex = RELATION_ORDER.indexOf(row.todayRelation);
        const offset = relationIndex >= 0 ? relationIndex - 3 : null;
        const derivedDate = anchorRow?.parsedDate && offset !== null
            ? getDateWithOffset(anchorRow.parsedDate, offset)
            : row.parsedDate;
        const key = derivedDate?.key || row.parsedDate?.key || '';
        if (!key) return;
        contentByDateKey.set(key, {
            ...row,
            dateKey: key,
            displayDate: row.dateText || derivedDate?.label || row.parsedDate?.label || key,
        });
    });
    return contentByDateKey;
}

function buildViewModel(resolved) {
    const daysTable = resolved.tables.days;
    const rows = mapTheaterRows(daysTable, (row, rowIndex) => normalizeCalendarRow(daysTable, row, rowIndex))
        .filter(row => row.dateText || row.majorEvent || row.dayContent);
    const anchorRow = resolveAnchorRow(rows);
    const anchorDate = anchorRow?.parsedDate || FALLBACK_ANCHOR;
    const contentByDateKey = buildContentByDateKey(rows, anchorRow);
    const selectedKey = anchorRow?.parsedDate?.key || contentByDateKey.keys().next().value || formatDateKey(anchorDate.year, anchorDate.monthIndex, anchorDate.day);
    const grid = buildMonthGrid(anchorDate.year, anchorDate.monthIndex);
    const todayKey = anchorRow?.parsedDate?.key || selectedKey;

    return {
        rows,
        anchorDate,
        selectedKey,
        todayKey,
        displayYear: anchorDate.year,
        displayMonthIndex: anchorDate.monthIndex,
        displayMonthLabel: `${anchorDate.year}年${anchorDate.monthIndex + 1}月`,
        weekdayHeadings: WEEKDAY_HEADINGS,
        grid: grid.map(day => ({
            ...day,
            isToday: day.key === todayKey,
            isSelected: day.key === selectedKey,
            hasContent: contentByDateKey.has(day.key),
            entry: contentByDateKey.get(day.key) || null,
        })),
        selectedEntry: contentByDateKey.get(selectedKey) || null,
        contentByDateKey,
        empty: rows.length <= 0,
    };
}

function collectDeletableKeys() {
    return [];
}

function deleteEntities() {
    return { removed: 0 };
}

function renderDayCell(day) {
    const classes = [
        'phone-theater-calendar-day',
        day.inCurrentMonth ? 'is-current-month' : 'is-outside-month',
        day.isToday ? 'is-today' : '',
        day.isSelected ? 'is-selected' : '',
        day.hasContent ? 'has-content' : '',
    ].filter(Boolean).join(' ');
    const entry = day.entry;
    const label = entry?.festivalText || entry?.majorEvent || day.label;
    const weatherSuffix = entry?.weatherText ? ` · ${entry.weatherText}` : '';
    const title = `${label}${weatherSuffix}`;
    return `
        <button type="button" class="${classes}" data-calendar-date-key="${escapeHtmlAttr(day.key)}" title="${escapeHtmlAttr(title)}">
            <span class="phone-theater-calendar-day-number">${escapeHtml(day.day)}</span>
            ${day.hasContent ? '<span class="phone-theater-calendar-dot" aria-hidden="true"></span>' : ''}
        </button>
    `;
}

function renderSelectedEntry(entry) {
    if (!entry) {
        return `
            <section class="phone-theater-calendar-detail is-empty">
                <div class="phone-theater-calendar-detail-title">暂无日程内容</div>
            </section>
        `;
    }

    return `
        <section class="phone-theater-calendar-detail">
            <div class="phone-theater-calendar-detail-head">
                <div>
                    <div class="phone-theater-calendar-detail-date">${escapeHtml(entry.displayDate || entry.dateText)}</div>
                    <div class="phone-theater-calendar-detail-relation">${escapeHtml(entry.todayRelation || '')}</div>
                </div>
                ${entry.dayStatus || entry.weatherText ? `
                    <div class="phone-theater-calendar-badges">
                        ${entry.dayStatus ? `<span class="phone-theater-calendar-status">${escapeHtml(entry.dayStatus)}</span>` : ''}
                        ${entry.weatherText ? `<span class="phone-theater-calendar-weather">${escapeHtml(entry.weatherText)}</span>` : ''}
                    </div>
                ` : ''}
            </div>
            ${entry.festivalText ? `<div class="phone-theater-calendar-festival">${escapeHtml(entry.festivalText)}</div>` : ''}
            ${entry.majorEvent ? `<div class="phone-theater-calendar-event">${escapeHtml(entry.majorEvent)}</div>` : ''}
            ${entry.dayContent ? `<p class="phone-theater-calendar-content">${escapeHtml(entry.dayContent)}</p>` : ''}
        </section>
    `;
}

function buildYearOptions(displayYear) {
    const safeYear = Number.isFinite(Number(displayYear)) ? Number(displayYear) : FALLBACK_ANCHOR.year;
    const startYear = Math.trunc(safeYear) - YEAR_PICKER_RANGE;
    return Array.from({ length: YEAR_PICKER_RANGE * 2 + 1 }, (_, index) => startYear + index);
}

function renderYearPicker(content) {
    const displayYear = Number(content?.displayYear);
    const safeDisplayYear = Number.isFinite(displayYear) ? Math.trunc(displayYear) : FALLBACK_ANCHOR.year;
    const years = buildYearOptions(safeDisplayYear);
    return `
        <div class="phone-theater-calendar-year-picker" data-calendar-year-picker="closed">
            <button type="button" class="phone-theater-calendar-year-toggle" data-calendar-action="toggle-year-picker" aria-expanded="false" aria-haspopup="listbox">
                <span class="phone-theater-calendar-year-toggle-text">${escapeHtml(safeDisplayYear)}</span>
                <span class="phone-theater-calendar-year-toggle-icon" aria-hidden="true">⌄</span>
            </button>
            <div class="phone-theater-calendar-year-panel" role="listbox" aria-label="选择年份">
                ${years.map((year) => `
                    <button type="button" class="phone-theater-calendar-year-option ${year === safeDisplayYear ? 'is-selected' : ''}" data-calendar-action="select-year" data-calendar-year="${escapeHtmlAttr(year)}" role="option" aria-selected="${year === safeDisplayYear ? 'true' : 'false'}">
                        ${escapeHtml(year)}
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

function renderContent(viewModel) {
    const content = viewModel?.content || {};
    if (content.empty) {
        return '<div class="phone-theater-calendar-page"><div class="phone-empty-msg phone-theater-empty">暂无小日历内容</div></div>';
    }

    return `
        <div class="phone-theater-calendar-page" ${SELECTED_DATE_ATTR}="${escapeHtmlAttr(content.selectedKey)}">
            <section class="phone-theater-calendar-header">
                <button type="button" class="phone-theater-calendar-nav-btn" data-calendar-action="prev-month" aria-label="上个月">‹</button>
                <div class="phone-theater-calendar-month-select">
                    <span class="phone-theater-calendar-month-label">${escapeHtml(content.displayMonthLabel)}</span>
                    ${renderYearPicker(content)}
                </div>
                <button type="button" class="phone-theater-calendar-nav-btn" data-calendar-action="next-month" aria-label="下个月">›</button>
            </section>
            <section class="phone-theater-calendar-weekdays">
                ${content.weekdayHeadings.map(label => `<span>${escapeHtml(label)}</span>`).join('')}
            </section>
            <section class="phone-theater-calendar-grid">
                ${content.grid.map(renderDayCell).join('')}
            </section>
            ${renderSelectedEntry(content.selectedEntry)}
        </div>
    `;
}

function setYearPickerOpen(container, open) {
    const picker = container.querySelector('.phone-theater-calendar-year-picker');
    const toggle = container.querySelector('.phone-theater-calendar-year-toggle');
    if (picker instanceof HTMLElement) {
        picker.dataset.calendarYearPicker = open ? 'open' : 'closed';
    }
    if (toggle instanceof HTMLElement) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
}

function renderYearOptions(container, displayYear) {
    const panel = container.querySelector('.phone-theater-calendar-year-panel');
    const toggleText = container.querySelector('.phone-theater-calendar-year-toggle-text');
    if (!(panel instanceof HTMLElement)) return;

    const safeDisplayYear = Number.isFinite(Number(displayYear)) ? Math.trunc(Number(displayYear)) : FALLBACK_ANCHOR.year;
    panel.innerHTML = buildYearOptions(safeDisplayYear).map((year) => `
        <button type="button" class="phone-theater-calendar-year-option ${year === safeDisplayYear ? 'is-selected' : ''}" data-calendar-action="select-year" data-calendar-year="${escapeHtmlAttr(year)}" role="option" aria-selected="${year === safeDisplayYear ? 'true' : 'false'}">
            ${escapeHtml(year)}
        </button>
    `).join('');
    if (toggleText instanceof HTMLElement) {
        toggleText.textContent = String(safeDisplayYear);
    }
}

function rerenderMonth(container, content, year, monthIndex, selectedKey) {
    const gridNode = container.querySelector('.phone-theater-calendar-grid');
    const labelNode = container.querySelector('.phone-theater-calendar-month-label');
    const detailNode = container.querySelector('.phone-theater-calendar-detail');
    if (!(gridNode instanceof HTMLElement) || !(labelNode instanceof HTMLElement)) return;

    const contentByDateKey = content.contentByDateKey instanceof Map ? content.contentByDateKey : new Map();
    const safeSelectedKey = selectedKey || container.querySelector('.phone-theater-calendar-page')?.getAttribute(SELECTED_DATE_ATTR) || content.selectedKey;
    const nextGrid = buildMonthGrid(year, monthIndex).map(day => ({
        ...day,
        isToday: day.key === content.todayKey,
        isSelected: day.key === safeSelectedKey,
        hasContent: contentByDateKey.has(day.key),
        entry: contentByDateKey.get(day.key) || null,
    }));
    labelNode.textContent = `${year}年${monthIndex + 1}月`;
    renderYearOptions(container, year);
    gridNode.innerHTML = nextGrid.map(renderDayCell).join('');
    const page = container.querySelector('.phone-theater-calendar-page');
    if (page instanceof HTMLElement) {
        page.dataset.calendarYear = String(year);
        page.dataset.calendarMonthIndex = String(monthIndex);
        page.setAttribute(SELECTED_DATE_ATTR, safeSelectedKey);
    }
    if (detailNode instanceof HTMLElement) {
        detailNode.outerHTML = renderSelectedEntry(contentByDateKey.get(safeSelectedKey) || null);
    }
}

function bindInteractions(container, context = {}) {
    const page = container.querySelector('.phone-theater-calendar-page');
    const content = context?.viewModel?.content || {};
    if (!(page instanceof HTMLElement) || !content || content.empty) return;
    if (page.dataset.calendarBound === 'true') return;
    page.dataset.calendarBound = 'true';
    page.dataset.calendarYear = String(content.displayYear);
    page.dataset.calendarMonthIndex = String(content.displayMonthIndex);

    const handleClick = (event) => {
        const actionNode = event.target instanceof Element ? event.target.closest('[data-calendar-action], [data-calendar-date-key]') : null;
        if (!(actionNode instanceof HTMLElement)) return;
        const currentYear = Number(page.dataset.calendarYear || content.displayYear);
        const currentMonthIndex = Number(page.dataset.calendarMonthIndex || content.displayMonthIndex);

        if (actionNode.dataset.calendarAction === 'toggle-year-picker') {
            const picker = page.querySelector('.phone-theater-calendar-year-picker');
            const isOpen = picker instanceof HTMLElement && picker.dataset.calendarYearPicker === 'open';
            setYearPickerOpen(page, !isOpen);
            return;
        }
        if (actionNode.dataset.calendarAction === 'select-year') {
            const year = Number(actionNode.dataset.calendarYear);
            if (!Number.isFinite(year)) return;
            setYearPickerOpen(page, false);
            rerenderMonth(container, content, Math.trunc(year), currentMonthIndex);
            return;
        }
        if (actionNode.dataset.calendarAction === 'prev-month') {
            setYearPickerOpen(page, false);
            const date = new Date(currentYear, currentMonthIndex - 1, 1);
            rerenderMonth(container, content, date.getFullYear(), date.getMonth());
            return;
        }
        if (actionNode.dataset.calendarAction === 'next-month') {
            setYearPickerOpen(page, false);
            const date = new Date(currentYear, currentMonthIndex + 1, 1);
            rerenderMonth(container, content, date.getFullYear(), date.getMonth());
            return;
        }
        const dateKey = normalizeText(actionNode.dataset.calendarDateKey);
        if (dateKey) {
            setYearPickerOpen(page, false);
            rerenderMonth(container, content, currentYear, currentMonthIndex, dateKey);
        }
    };

    context.addEventListener(page, 'click', handleClick);
}

export const calendarScene = Object.freeze({
    id: 'calendar',
    appKey: '__theater_calendar',
    name: '小日历',
    iconText: '历',
    iconColors: ['#FF3B30', '#FF9500'],
    orderNo: 4,
    title: '小日历',
    subtitle: '七日窗口月历',
    emptyText: '暂无小日历内容',
    styleScope: 'calendar',
    primaryTableRole: 'days',
    deletable: false,
    tables: CALENDAR_TABLES,
    editableTables: Object.freeze([
        Object.freeze({
            role: 'days',
            label: '编辑小日历表',
            description: '进入原始七日窗口表格列表',
        }),
    ]),
    fieldSchema: Object.freeze({
        days: Object.freeze({ identity: '与今天的关系' }),
    }),
    contract: Object.freeze({
        styleFile: 'styles/phone-theater/calendar.css',
        requiredClasses: [
            'phone-theater-calendar-page',
            'phone-theater-calendar-header',
            'phone-theater-calendar-grid',
            'phone-theater-calendar-day',
            'phone-theater-calendar-detail',
        ],
    }),
    buildViewModel,
    collectDeletableKeys,
    deleteEntities,
    renderContent,
    bindInteractions,
});
