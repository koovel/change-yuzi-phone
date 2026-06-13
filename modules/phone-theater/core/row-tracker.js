/**
 * 追踪各小剧场表的"修改/添加行"。
 * 当某行被新增或修改时，将其 row_id 记录下来，
 * 在下次渲染时将其排在第 1 页。
 */

/** @type {Map<string, { rowId: string, timestamp: number }>} */
const modifiedRows = new Map();

/** @type {Map<string, string>} */
const lastKnownMaxRowIds = new Map();

/** @type {Map<string, Map<string, string>>} tableName -> (rowId -> contentSnapshot) */
const rowContentSnapshots = new Map();

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

/**
 * 基于内容快照检测被修改的行。
 * 每次调用时，将当前行内容与上次快照比较，找出内容发生变化的行。
 * 同时更新快照以便下次比较。
 *
 * @param {string} tableName 表名
 * @param {Array<Array>} dataRows 去掉表头后的原始行数组
 * @param {number} rowIdColIndex row_id 列在行数组中的索引
 * @returns {string|null} 内容发生变化的行的 row_id，若无变化返回 null
 */
export function detectModifiedRowBySnapshot(tableName, dataRows, rowIdColIndex) {
    const safeName = normalizeTableName(tableName);
    if (!safeName || !Array.isArray(dataRows) || rowIdColIndex < 0) return null;

    const previousSnapshot = rowContentSnapshots.get(safeName) || new Map();
    const currentSnapshot = new Map();
    let modifiedRowId = null;

    for (const row of dataRows) {
        if (!Array.isArray(row)) continue;
        const rowId = normalizeRowId(row[rowIdColIndex]);
        if (!rowId) continue;

        // 用分隔符拼接整行内容作为快照键（跳过 row_id 列本身以减少噪音）
        const contentParts = [];
        for (let i = 0; i < row.length; i++) {
            if (i === rowIdColIndex) continue;
            contentParts.push(String(row[i] ?? ''));
        }
        const contentKey = contentParts.join('\x1F');
        currentSnapshot.set(rowId, contentKey);

        // 仅在已有快照时才进行比较（首次调用不触发修改检测）
        if (previousSnapshot.has(rowId)) {
            const prevContent = previousSnapshot.get(rowId);
            if (prevContent !== contentKey && !modifiedRowId) {
                modifiedRowId = rowId;
            }
        }
    }

    rowContentSnapshots.set(safeName, currentSnapshot);
    return modifiedRowId;
}