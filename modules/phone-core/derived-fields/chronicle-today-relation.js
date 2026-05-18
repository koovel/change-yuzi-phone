import { Logger } from '../../error-handler.js';
import { findAutoManagedRowIdColumnIndex } from '../../utils/table-column-metadata.js';
import { getTableData, processTableData, updateTableCell } from '../data-api.js';
import {
    calculateTodayRelation,
    parseDateText,
    parseRelationDateFromTimeSpan,
} from '../date-relation.js';
import { subscribeTableUpdate } from '../callbacks.js';

const logger = Logger.withScope({ scope: 'phone-core/derived-fields/chronicle-today-relation', feature: 'derived-fields' });

const CALENDAR_TABLE_NAME = '小日历表';
const CHRONICLE_TABLE_NAME = '纪要表';
const HEADER_CALENDAR_DATE = '日期';
const HEADER_TIME_SPAN = '时间跨度';
const HEADER_TODAY_RELATION = '与今天的关系';
const HEADER_MONTH_DAYS = '月份几天';
const TODAY_RELATION_VALUE = '今天';

const runtime = {
    unsubscribe: null,
    running: false,
    pending: false,
    applying: false,
    lastInputSignature: null,
};

function normalizeText(value) {
    return String(value ?? '').trim();
}

function findHeaderIndex(headers, headerName) {
    return Array.isArray(headers) ? headers.findIndex(header => normalizeText(header) === headerName) : -1;
}

function readCell(row, index) {
    return Array.isArray(row) && index >= 0 ? row[index] : '';
}

function resolveTables(rawData) {
    const tables = processTableData(rawData);
    if (!tables || typeof tables !== 'object') return null;
    const calendarTable = tables[CALENDAR_TABLE_NAME];
    const chronicleTable = tables[CHRONICLE_TABLE_NAME];
    if (!calendarTable || !chronicleTable) return null;
    return { calendarTable, chronicleTable };
}

function resolveRequiredIndexes(table, names) {
    const indexes = {};
    for (const [key, headerName] of Object.entries(names)) {
        const index = findHeaderIndex(table?.headers, headerName);
        if (index < 0) return null;
        indexes[key] = index;
    }
    return indexes;
}

function resolveChronicleIndexes(chronicleTable) {
    const requiredIndexes = resolveRequiredIndexes(chronicleTable, {
        timeSpan: HEADER_TIME_SPAN,
        todayRelation: HEADER_TODAY_RELATION,
    });
    if (!requiredIndexes) return null;

    return {
        ...requiredIndexes,
        rowId: findAutoManagedRowIdColumnIndex(chronicleTable?.headers),
    };
}

function buildChronicleInputSignature(chronicleTable, chronicleIndexes) {
    const rows = Array.isArray(chronicleTable?.rows) ? chronicleTable.rows : [];
    return rows
        .map((row, index) => {
            const rowId = normalizeText(readCell(row, chronicleIndexes.rowId)) || `@row:${index + 1}`;
            const timeSpan = normalizeText(readCell(row, chronicleIndexes.timeSpan));
            return `${rowId}\u001f${timeSpan}`;
        })
        .join('\u001e');
}

function findTodayDate(calendarTable, calendarIndexes) {
    const rows = Array.isArray(calendarTable?.rows) ? calendarTable.rows : [];
    for (const row of rows) {
        const relation = normalizeText(readCell(row, calendarIndexes.todayRelation));
        if (relation !== TODAY_RELATION_VALUE) continue;

        const dateText = normalizeText(readCell(row, calendarIndexes.date));
        const monthDays = normalizeText(calendarIndexes.monthDays >= 0 ? readCell(row, calendarIndexes.monthDays) : '');
        const parsedDate = parseDateText(dateText, monthDays);
        if (parsedDate) return parsedDate;
    }
    return null;
}

function collectChronicleUpdates(chronicleTable, chronicleIndexes, todayDate) {
    const rows = Array.isArray(chronicleTable?.rows) ? chronicleTable.rows : [];
    const updates = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const timeSpan = normalizeText(readCell(row, chronicleIndexes.timeSpan));
        const targetDate = parseRelationDateFromTimeSpan(timeSpan);
        if (!targetDate) continue;

        const relation = calculateTodayRelation(todayDate, targetDate);
        if (!relation) continue;

        const currentRelation = normalizeText(readCell(row, chronicleIndexes.todayRelation));
        if (currentRelation === relation) continue;

        updates.push({
            dbRowIndex: rowIndex + 1,
            value: relation,
        });
    }
    return updates;
}

async function applyChronicleUpdates(updates) {
    runtime.applying = true;
    try {
        for (let index = 0; index < updates.length; index += 1) {
            const update = updates[index];
            const isLast = index === updates.length - 1;
            const result = await updateTableCell(
                CHRONICLE_TABLE_NAME,
                update.dbRowIndex,
                HEADER_TODAY_RELATION,
                update.value,
                { refreshProjection: isLast },
            );
            if (!result?.ok) {
                logger.warn({
                    action: 'chronicle-today-relation.write-failed',
                    message: '纪要表“与今天的关系”写入未确认成功',
                    context: {
                        rowIndex: update.dbRowIndex,
                        code: result?.code,
                        message: result?.message,
                    },
                });
            }
        }
    } finally {
        runtime.applying = false;
    }
}

async function runChronicleTodayRelationInjection() {
    if (runtime.running) {
        runtime.pending = true;
        return;
    }

    runtime.running = true;
    try {
        do {
            runtime.pending = false;
            const rawData = getTableData();
            const resolved = resolveTables(rawData);
            if (!resolved) return;

            const calendarIndexes = resolveRequiredIndexes(resolved.calendarTable, {
                date: HEADER_CALENDAR_DATE,
                todayRelation: HEADER_TODAY_RELATION,
            });
            const monthDaysIndex = findHeaderIndex(resolved.calendarTable?.headers, HEADER_MONTH_DAYS);
            if (!calendarIndexes) return;
            calendarIndexes.monthDays = monthDaysIndex;

            const chronicleIndexes = resolveChronicleIndexes(resolved.chronicleTable);
            if (!chronicleIndexes) return;

            const inputSignature = buildChronicleInputSignature(resolved.chronicleTable, chronicleIndexes);
            if (inputSignature === runtime.lastInputSignature) return;
            runtime.lastInputSignature = inputSignature;

            const todayDate = findTodayDate(resolved.calendarTable, calendarIndexes);
            if (!todayDate) return;

            const updates = collectChronicleUpdates(resolved.chronicleTable, chronicleIndexes, todayDate);
            if (updates.length <= 0) return;

            const latestRawData = getTableData();
            const latestResolved = resolveTables(latestRawData);
            const latestChronicleIndexes = latestResolved
                ? resolveChronicleIndexes(latestResolved.chronicleTable)
                : null;
            if (!latestChronicleIndexes) return;

            const latestInputSignature = buildChronicleInputSignature(latestResolved.chronicleTable, latestChronicleIndexes);
            if (latestInputSignature !== inputSignature) {
                runtime.lastInputSignature = null;
                runtime.pending = true;
                continue;
            }

            await applyChronicleUpdates(updates);
        } while (runtime.pending);
    } catch (error) {
        logger.warn({
            action: 'chronicle-today-relation.run-error',
            message: '纪要表“与今天的关系”派生注入失败',
            error,
        });
    } finally {
        runtime.running = false;
        runtime.applying = false;
    }
}

function handleTableUpdate() {
    if (runtime.applying) {
        runtime.pending = true;
        return;
    }
    void runChronicleTodayRelationInjection();
}

export function startChronicleTodayRelationInjection() {
    if (runtime.unsubscribe) return true;
    const unsubscribe = subscribeTableUpdate(handleTableUpdate);
    runtime.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
    if (!runtime.unsubscribe) return false;

    void runChronicleTodayRelationInjection();
    return true;
}

export function stopChronicleTodayRelationInjection() {
    if (typeof runtime.unsubscribe === 'function') {
        runtime.unsubscribe();
    }
    runtime.unsubscribe = null;
    runtime.running = false;
    runtime.pending = false;
    runtime.applying = false;
    runtime.lastInputSignature = null;
}
