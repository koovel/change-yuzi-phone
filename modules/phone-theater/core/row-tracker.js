/**
 * 追踪各小剧场表的"修改/添加行"。
 * 当某行被新增或修改时，将其 row_id 记录下来，
 * 在下次渲染时将其排在第 1 页。
 */

/** @type {Map<string, { rowId: string, timestamp: number }>} */
const modifiedRows = new Map();

/** @type {Map<string, string>} */
const lastKnownMaxRowIds = new Map();

function normalizeTableName(tableName) {
    return String(tableName || '').trim();
}

function normalizeRowId(rowId) {
    return String(rowId ?? '').trim();
}

/**
 * 标记某行为"修改/添加行"。
 * @param {string} tableName 表名
 * @param {string|number} rowId  行的 row_id 值
 */
export function setModifiedRow(tableName, rowId) {
    const safeName = normalizeTableName(tableName);
    const safeId = normalizeRowId(rowId);
    if (!safeName || !safeId) return;
    modifiedRows.set(safeName, { rowId: safeId, timestamp: Date.now() });
}

/**
 * 获取某表当前追踪的"修改/添加行" row_id。
 * @param {string} tableName
 * @returns {string|null}
 */
export function getModifiedRowId(tableName) {
    const safeName = normalizeTableName(tableName);
    const entry = modifiedRows.get(safeName);
    return entry ? entry.rowId : null;
}

/**
 * 清除某表的"修改/添加行"追踪。
 * @param {string} tableName
 */
export function clearModifiedRow(tableName) {
    const safeName = normalizeTableName(tableName);
    modifiedRows.delete(safeName);
}

/**
 * 清除所有表的"修改/添加行"追踪。
 */
export function clearAllModifiedRows() {
    modifiedRows.clear();
}

/**
 * 更新某表已知的最大 row_id（用于自动检测新增行）。
 * @param {string} tableName
 * @param {string|number} rowId
 */
export function setLastKnownMaxRowId(tableName, rowId) {
    const safeName = normalizeTableName(tableName);
    const safeId = normalizeRowId(rowId);
    if (!safeName || !safeId) return;
    lastKnownMaxRowIds.set(safeName, safeId);
}

/**
 * 获取某表上次已知的最大 row_id。
 * @param {string} tableName
 * @returns {string|null}
 */
export function getLastKnownMaxRowId(tableName) {
    const safeName = normalizeTableName(tableName);
    return lastKnownMaxRowIds.get(safeName) || null;
}

/**
 * 清除所有表的最大 row_id 记录。
 */
export function clearAllLastKnownMaxRowIds() {
    lastKnownMaxRowIds.clear();
}
