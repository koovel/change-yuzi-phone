import { remapTableLockStateAfterRowDelete } from '../phone-core/data-api.js';

function applyLockStateAfterRowDelete(sheetKey, deletedRowIndex) {
    remapTableLockStateAfterRowDelete(sheetKey, deletedRowIndex);
}

function isRuntimeDisposed(runtime) {
    return !!(runtime && typeof runtime.isDisposed === 'function' && runtime.isDisposed());
}

function isRuntimeActive(runtime) {
    return !isRuntimeDisposed(runtime);
}

function createDeleteOutcome({
    ok = false,
    deleted = false,
    message = '',
    refreshed = null,
    viewSynced = null,
    deletedCount = 0,
    requestedRowIndexes = [],
    deletedRowIndexes = [],
    failedRowIndexes = [],
} = {}) {
    return {
        ok,
        deleted,
        message,
        refreshed,
        viewSynced,
        deletedCount,
        requestedRowIndexes,
        deletedRowIndexes,
        failedRowIndexes,
    };
}

export function createRowDeleteController(options) {
    const {
        sheetKey,
        rows,
        state,
        container,
        getSheetDataByKey,
        getLiveTableName,
        syncRowsFromSheet,
        isTableRowLocked,
        deletePhoneSheetRows,
        showInlineToast,
        viewerRuntime,
    } = options;

    const isViewerActive = () => isRuntimeActive(viewerRuntime);

    const deleteRowFromList = async (rowIndex) => {
        const latestSheet = getSheetDataByKey(sheetKey);
        if (!latestSheet?.rows || !Array.isArray(latestSheet.rows)) {
            const message = '删除失败：表格不存在';
            showInlineToast(container, message, true);
            return createDeleteOutcome({ message });
        }

        if (!Array.isArray(latestSheet.rows[rowIndex])) {
            const message = '删除失败：行不存在';
            showInlineToast(container, message, true);
            return createDeleteOutcome({ message });
        }

        if (isTableRowLocked(sheetKey, rowIndex)) {
            const message = '删除失败：条目已锁定';
            showInlineToast(container, message, true);
            return createDeleteOutcome({ message });
        }

        const liveTableName = getLiveTableName();
        if (!liveTableName) {
            const message = '删除失败：缺少表格名称';
            showInlineToast(container, message, true);
            return createDeleteOutcome({ message });
        }

        const result = await deletePhoneSheetRows(sheetKey, [rowIndex], {
            tableName: liveTableName,
        });
        const deletedRowIndexes = Array.isArray(result.deletedRowIndexes) ? result.deletedRowIndexes : [];
        const deletedCurrentRow = deletedRowIndexes.includes(rowIndex);
        if (!result.ok && !deletedCurrentRow) {
            const message = result.message || '删除失败';
            if (isViewerActive()) {
                syncRowsFromSheet();
                showInlineToast(container, message, true);
            }
            return createDeleteOutcome({
                message,
                refreshed: result.refreshed ?? null,
                deletedCount: result.deletedCount || 0,
                requestedRowIndexes: result.requestedRowIndexes || [rowIndex],
                deletedRowIndexes,
                failedRowIndexes: result.failedRowIndexes || [rowIndex],
            });
        }

        applyLockStateAfterRowDelete(sheetKey, rowIndex);
        if (!isViewerActive()) {
            return createDeleteOutcome({
                ok: !!result.ok,
                deleted: true,
                message: result.message || (result.ok ? '删除成功' : '删除已部分完成'),
                refreshed: result.refreshed ?? null,
                viewSynced: null,
                deletedCount: result.deletedCount || 1,
                requestedRowIndexes: result.requestedRowIndexes || [rowIndex],
                deletedRowIndexes: deletedRowIndexes.length > 0 ? deletedRowIndexes : [rowIndex],
                failedRowIndexes: result.failedRowIndexes || [],
            });
        }

        const synced = syncRowsFromSheet();
        const message = result.message || '删除成功';

        if (!synced) {
            return createDeleteOutcome({
                ok: true,
                deleted: true,
                message: `${message}，但当前视图未同步到最新表格`,
                refreshed: result.refreshed ?? null,
                viewSynced: false,
                deletedCount: result.deletedCount || 1,
                requestedRowIndexes: result.requestedRowIndexes || [rowIndex],
                deletedRowIndexes: deletedRowIndexes.length > 0 ? deletedRowIndexes : [rowIndex],
                failedRowIndexes: result.failedRowIndexes || [],
            });
        }

        if (rows.length === 0) {
            state.returnToListMode();
        } else {
            state.reconcileAfterRowDelete(rowIndex, rows.length);
        }

        return createDeleteOutcome({
            ok: true,
            deleted: true,
            message,
            refreshed: result.refreshed ?? null,
            viewSynced: true,
            deletedCount: result.deletedCount || 1,
            requestedRowIndexes: result.requestedRowIndexes || [rowIndex],
            deletedRowIndexes: deletedRowIndexes.length > 0 ? deletedRowIndexes : [rowIndex],
            failedRowIndexes: result.failedRowIndexes || [],
        });
    };

    return {
        deleteRowFromList,
    };
}
