import {
    DEFAULT_API_TIMEOUT,
    callApiWithTimeout,
    getDB,
    hasDbApiMethod,
    isDbBooleanSuccess,
} from '../db-bridge.js';

const OPERATIONS = Object.freeze({
    exportSnapshot: 'exportDatabaseSnapshot',
    importTemplate: 'importTemplateFromData',
    refreshProjection: 'refreshDatabaseProjection',
});

function serializeError(error) {
    if (!error) return null;
    return {
        name: String(error.name || 'Error'),
        message: String(error.message || error),
    };
}

function buildResult({ ok, operation, code, message, data = null, scope = null, error = null }) {
    return {
        ok: Boolean(ok),
        operation,
        code,
        message,
        data,
        scope,
        error: serializeError(error),
    };
}

function getApiForOperation(operation, methodName) {
    let api = null;
    try {
        api = getDB();
    } catch (error) {
        return buildResult({
            ok: false,
            operation,
            code: 'api_unavailable',
            message: '数据库 API 不可用，请确认数据库插件已加载',
            error,
        });
    }

    if (!api) {
        return buildResult({
            ok: false,
            operation,
            code: 'api_unavailable',
            message: '数据库 API 不可用，请确认数据库插件已加载',
        });
    }

    if (!hasDbApiMethod(api, methodName)) {
        return buildResult({
            ok: false,
            operation,
            code: 'method_unavailable',
            message: `数据库 API 缺少方法：${methodName}`,
        });
    }

    return { ok: true, api };
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTemplateImportOptions(options = {}) {
    const source = isPlainObject(options) ? options : {};
    const scope = source.scope === 'global' ? 'global' : 'chat';
    const presetName = String(source.presetName || '').trim();
    return presetName ? { scope, presetName } : { scope };
}

async function callRepositoryApi(operation, methodName, invoke, timeout) {
    const apiPack = getApiForOperation(operation, methodName);
    if (!apiPack.ok) return apiPack;

    const result = await callApiWithTimeout(
        () => invoke(apiPack.api),
        timeout,
        `import-export-repository.${methodName}`,
    );
    return { ok: true, apiResult: result };
}


function normalizeTimeout(options = {}) {
    const timeout = Number(isPlainObject(options) ? options.timeout : undefined);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_API_TIMEOUT;
}

export async function exportDatabaseSnapshotViaApi(options = {}) {
    const operation = OPERATIONS.exportSnapshot;
    const call = await callRepositoryApi(
        operation,
        'exportTableAsJson',
        (api) => api.exportTableAsJson(),
        normalizeTimeout(options),
    );
    if (!call.ok) return call;

    const snapshot = call.apiResult;
    if (snapshot === null) {
        return buildResult({
            ok: false,
            operation,
            code: 'api_call_failed',
            message: '导出当前数据库快照失败：API 调用可能超时、异常或返回 null',
        });
    }
    if (!isPlainObject(snapshot)) {
        return buildResult({
            ok: false,
            operation,
            code: 'invalid_response',
            message: '导出当前数据库快照失败：exportTableAsJson 未返回对象',
            data: { responseType: Array.isArray(snapshot) ? 'array' : typeof snapshot },
        });
    }

    return buildResult({
        ok: true,
        operation,
        code: 'ok',
        message: '已导出当前数据库快照',
        data: snapshot,
    });
}

export async function importTemplateFromDataViaApi(templateData, options = {}) {
    const operation = OPERATIONS.importTemplate;
    if (!isPlainObject(templateData)) {
        return buildResult({
            ok: false,
            operation,
            code: 'invalid_input',
            message: '导入模板失败：templateData 必须是对象',
        });
    }

    const importOptions = normalizeTemplateImportOptions(options);
    const call = await callRepositoryApi(
        operation,
        'importTemplateFromData',
        (api) => api.importTemplateFromData(templateData, importOptions),
        normalizeTimeout(options),
    );
    if (!call.ok) return { ...call, scope: importOptions.scope };

    const result = call.apiResult;
    if (result === null) {
        return buildResult({
            ok: false,
            operation,
            code: 'api_call_failed',
            message: '导入模板失败：API 调用可能超时、异常或返回 null',
            scope: importOptions.scope,
        });
    }
    if (result === false) {
        return buildResult({
            ok: false,
            operation,
            code: 'import_rejected',
            message: '导入模板失败：importTemplateFromData 未确认成功',
            data: { result },
            scope: importOptions.scope,
        });
    }

    return buildResult({
        ok: true,
        operation,
        code: 'ok',
        message: '模板已导入数据库预设',
        data: { result, options: importOptions },
        scope: importOptions.scope,
    });
}


export async function refreshDatabaseProjectionViaApi(options = {}) {
    const operation = OPERATIONS.refreshProjection;
    const call = await callRepositoryApi(
        operation,
        'refreshDataAndWorldbook',
        (api) => api.refreshDataAndWorldbook(),
        normalizeTimeout(options),
    );
    if (!call.ok) return call;

    const result = call.apiResult;
    if (result === null) {
        return buildResult({
            ok: false,
            operation,
            code: 'api_call_failed',
            message: '刷新数据库投影失败：API 调用可能超时、异常或返回 null',
        });
    }
    if (!isDbBooleanSuccess(result)) {
        return buildResult({
            ok: false,
            operation,
            code: 'refresh_rejected',
            message: '刷新数据库投影失败：refreshDataAndWorldbook 未确认成功',
            data: { result },
        });
    }

    return buildResult({
        ok: true,
        operation,
        code: 'ok',
        message: '数据库投影已刷新',
        data: { result },
    });
}
