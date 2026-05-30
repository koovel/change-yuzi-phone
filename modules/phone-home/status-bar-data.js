// modules/phone-home/status-bar-data.js
import { processTableData } from '../phone-core/data-api.js';

const GLOBAL_TABLE_NAME = '全局数据表';
const CALENDAR_TABLE_NAME = '小日历表';
const HEADER_CURRENT_TIME = '当前时间';
const HEADER_TODAY_RELATION = '与今天的关系';
const TODAY_RELATION_VALUE = '今天';

function findHeaderIndex(headers, name) {
    return Array.isArray(headers) ? headers.findIndex(h => String(h ?? '').trim() === name) : -1;
}

function readCell(row, index) {
    if (!Array.isArray(row) || index < 0) return '';
    return String(row[index] ?? '').trim();
}

export function resolveStatusBarData(rawData) {
    const result = {
        currentTime: null,
        weekday: null,
        dayStatus: null,
        weather: null,
        majorEvent: null
    };
    const tables = processTableData(rawData);
    if (!tables) return result;

    // 全局数据表 → 当前时间
    const globalTable = tables[GLOBAL_TABLE_NAME];
    if (globalTable) {
        const timeIndex = findHeaderIndex(globalTable.headers, HEADER_CURRENT_TIME);
        if (timeIndex >= 0 && Array.isArray(globalTable.rows) && globalTable.rows.length > 0) {
            const value = readCell(globalTable.rows[0], timeIndex);
            if (value) result.currentTime = value;
        }
    }

    // 小日历表 → 今天行摘要
    const calendarTable = tables[CALENDAR_TABLE_NAME];
    if (calendarTable) {
        const relationIndex = findHeaderIndex(calendarTable.headers, HEADER_TODAY_RELATION);
        if (relationIndex >= 0 && Array.isArray(calendarTable.rows)) {
            const todayRow = calendarTable.rows.find(row => readCell(row, relationIndex) === TODAY_RELATION_VALUE);
            if (todayRow) {
                const weekdayVal = readCell(todayRow, findHeaderIndex(calendarTable.headers, '星期几'));
                const statusVal = readCell(todayRow, findHeaderIndex(calendarTable.headers, '状态'));
                const weatherVal = readCell(todayRow, findHeaderIndex(calendarTable.headers, '天气'));
                const eventVal = readCell(todayRow, findHeaderIndex(calendarTable.headers, '大事件'));

                if (weekdayVal) result.weekday = weekdayVal;
                if (statusVal) result.dayStatus = statusVal;
                if (weatherVal) result.weather = weatherVal;
                if (eventVal) result.majorEvent = eventVal;
            }
        }
    }

    return result;
}
