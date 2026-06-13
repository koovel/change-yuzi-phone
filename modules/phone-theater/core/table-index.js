import { getSheetKeys } from '../../phone-core/data-api.js';

export function normalizeText(value) {
    return String(value ?? '').trim();
}

function cloneRow(row) {
    return Array.isArray(row) ? [...row] : [];
}

function normalizeHeader(header, index) {
    return normalizeText(header) || `列${index + 1}`;
}

export function buildTheaterTableIndex(rawData) {
    const tableByName = new Map();
    const tableBySheetKey = new Map();
    const sheetKeys = getSheetKeys(rawData);

    sheetKeys.forEach((sheetKey) => {
        const sheet = rawData?.[sheetKey];
        const tableName = normalizeText(sheet?.name || sheetKey);
        const content = Array.isArray(sheet?.content) ? sheet.content : [];
        if (!tableName || content.length <= 0) return;

        const headers = Array.isArray(content[0])
            ? content[0].map(normalizeHeader)
            : [];
        const rows = content.slice(1).map(cloneRow);
        const table = {
            sheetKey,
            tableName,
            sheet,
            headers,
            rows,
            rowCount: rows.length,
            orderNo: Number.isFinite(sheet?.orderNo) ? Number(sheet.orderNo) : Number.POSITIVE_INFINITY,
        };

        if (!tableByName.has(tableName)) {
            tableByName.set(tableName, table);
        }
        tableBySheetKey.set(sheetKey, table);
    });

    return {
        sheetKeys,
        tableByName,
        tableBySheetKey,
    };
}

export function getCellByHeader(table, row, headerName, fallback = '') {
    if (!table || !Array.isArray(row)) return fallback;
    const headers = Array.isArray(table.headers) ? table.headers : [];
    const index = headers.findIndex(header => normalizeText(header) === normalizeText(headerName));
    if (index < 0) return fallback;
    const value = row[index];
    return value === undefined || value === null ? fallback : value;
}

export function splitSemicolonText(value) {
    const text = normalizeText(value);
    if (!text) return [];
    return text
        .replace(/；/g, ';')
        .split(';')
        .map(part => normalizeText(part))
        .filter(Boolean);
}

export function resolveRowIdentity(table, row, headerName, fallbackPrefix, rowIndex) {
    const fallback = `${fallbackPrefix}${rowIndex + 1}`;
    return normalizeText(getCellByHeader(table, row, headerName, fallback)) || fallback;
}

export function mapTheaterRows(table, mapper) {
    if (!table || !Array.isArray(table.rows)) return [];
    return table.rows.map((row, rowIndex) => mapper(row, rowIndex)).filter(Boolean);
}

/**
 * 从一行原始数据中提取 row_id 值。
 * @param {Object} table  buildTheaterTableIndex 返回的 table 对象
 * @param {Array}  row    原始行数组
 * @param {string} fallback 找不到时的回退值
 * @returns {string}
 */
export function getRowIdValue(table, row, fallback = '') {
    return normalizeText(getCellByHeader(table, row, 'row_id', fallback));
}

/**
 * 对小剧场视图模型数组进行翻页排序。
 *
 * 排序规则：
 *  1. 如果存在 modifiedRowId 对应的项，它始终排在最前面（第 1 页）。
 *  2. 其余项按 rowId 倒序排列（rowId 越大越靠前）。
 *  3. 如果不存在 modifiedRowId，所有项统一按 rowId 倒序排列。
 *
 * @param {Array}  items         视图模型数组，每项需有 rowId 属性
 * @param {string|null} modifiedRowId 需要排在第 1 页的 row_id，null 表示不存在
 * @returns {Array} 排序后的新数组
 */
export function sortTheaterRows(items, modifiedRowId) {
    if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? [...items] : [];

    const safeModifiedId = normalizeText(modifiedRowId);

    return [...items].sort((a, b) => {
        const aId = normalizeText(a?.rowId);
        const bId = normalizeText(b?.rowId);

        // modified row always first
        if (safeModifiedId) {
            if (aId === safeModifiedId && bId !== safeModifiedId) return -1;
            if (bId === safeModifiedId && aId !== safeModifiedId) return 1;
        }

        // sort by row_id descending (try numeric first)
        const aNum = Number(aId);
        const bNum = Number(bId);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
            return bNum - aNum;
        }

        // fallback: string descending
        return bId.localeCompare(aId);
    });
}
