import {
    getSheetKeys,
    getTableDataAsync,
    importTemplateFromDataViaApi,
    refreshDatabaseProjectionViaApi,
} from '../phone-core/data-api.js';
import { pickJsonFile } from './utils.js';
import { clearFusionResult } from './runtime.js';
import { performFusionMerge, renderFusionCompare } from './compare-merge.js';
import {
    createBuiltinTheaterSourceModel,
    createDatabaseCurrentSourceModel,
    createLocalJsonSourceModel,
    validateFusionTemplate,
} from './source-model.js';

export function reportFusionError(message, error = null, deps = {}) {
    const { Logger, showNotification } = deps;
    if (error && Logger?.warn) {
        Logger.warn(`[phone-fusion] ${message}`, error);
    }
    showNotification?.(message, 'error');
}

function createRuntimeAdapter(runtime) {
    if (runtime && typeof runtime.addEventListener === 'function') {
        return runtime;
    }

    const cleanups = [];
    return {
        addEventListener(target, type, handler, options) {
            if (!target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') return () => {};
            target.addEventListener(type, handler, options);
            const cleanup = () => target.removeEventListener(type, handler, options);
            cleanups.push(cleanup);
            return cleanup;
        },
        registerCleanup(cleanup) {
            if (typeof cleanup === 'function') cleanups.push(cleanup);
            return () => {};
        },
        setTimeout(callback, delay) {
            const id = window.setTimeout(callback, delay);
            cleanups.push(() => window.clearTimeout(id));
            return id;
        },
        disposeFallback() {
            cleanups.splice(0).forEach((cleanup) => {
                try { cleanup(); } catch {}
            });
        },
    };
}

function setSourceStatus(container, slot, label) {
    const slotKey = String(slot || '').toLowerCase();
    const nameEl = container.querySelector(`#phone-fname-${slotKey}`);
    if (nameEl) nameEl.textContent = label;
    container.querySelector(`#phone-source-${slotKey}`)?.classList.add('phone-fusion-imported');
}

function getTemplateImportOptions(container) {
    const scopeSelect = container.querySelector('#phone-fusion-template-scope');
    const presetNameInput = container.querySelector('#phone-fusion-template-preset-name');
    const scope = scopeSelect?.value === 'global' ? 'global' : 'chat';
    const presetName = String(presetNameInput?.value || '').trim();
    return { scope, presetName };
}

function getTemplateScopeLabel(scope) {
    return scope === 'global' ? '全局' : '当前聊天';
}

function getTemplateImportSuccessText(importResult, options) {
    const scopeLabel = getTemplateScopeLabel(importResult?.scope || options.scope);
    const presetName = String(options.presetName || '').trim();
    return presetName
        ? `模板已导入${scopeLabel}预设：${presetName}`
        : `模板已导入${scopeLabel}预设`;
}

export function createFusionInteractionController(deps = {}) {
    const {
        navigateBack,
        Logger,
        showNotification,
        runtime,
    } = deps;

    const runtimeApi = createRuntimeAdapter(runtime);
    let sourceA = null;
    let sourceB = null;
    let sourceAName = '';
    let sourceBName = '';

    const tryRenderCompare = (container) => {
        renderFusionCompare(container, sourceA, sourceB);
    };

    const performMerge = (container) => {
        return performFusionMerge(container, sourceA, sourceB);
    };

    const setSourceA = (container, source, label) => {
        sourceA = source;
        sourceAName = label;
        clearFusionResult(container);
        setSourceStatus(container, 'A', label);
        tryRenderCompare(container);
    };

    const setSourceB = (container, source, label) => {
        sourceB = source;
        sourceBName = label;
        clearFusionResult(container);
        setSourceStatus(container, 'B', label);
        tryRenderCompare(container);
    };

    const bind = (container) => {
        if (!(container instanceof HTMLElement)) return () => {};

        const onImportA = () => {
            pickJsonFile((obj, name) => {
                setSourceA(container, createLocalJsonSourceModel(obj, name), name);
            }, (message, error) => reportFusionError(message, error, { Logger, showNotification }), runtimeApi);
        };

        const onUseBuiltinA = () => {
            setSourceA(container, createBuiltinTheaterSourceModel(), '内置小剧场模板');
        };

        const onImportB = () => {
            pickJsonFile((obj, name) => {
                setSourceB(container, createLocalJsonSourceModel(obj, name), name);
            }, (message, error) => reportFusionError(message, error, { Logger, showNotification }), runtimeApi);
        };

        const onUseCurrentDatabaseB = async () => {
            try {
                const rawData = await getTableDataAsync();
                const sheetCount = getSheetKeys(rawData).length;
                if (!rawData || sheetCount === 0) {
                    reportFusionError('当前数据库表格为空，无法作为模板 B 来源', null, { Logger, showNotification });
                    return;
                }
                setSourceB(
                    container,
                    createDatabaseCurrentSourceModel(rawData, { name: '当前数据库表格' }),
                    `当前数据库表格（${sheetCount} 张）`,
                );
            } catch (error) {
                reportFusionError('读取当前数据库表格失败', error, { Logger, showNotification });
            }
        };

        const onImportTemplate = async () => {
            const importButton = container.querySelector('#phone-fusion-import-template');
            if (importButton?.disabled) return;
            if (importButton) importButton.disabled = true;

            try {
                const mergeResult = performMerge(container);
                if (!mergeResult || mergeResult.sheetCount === 0) {
                    reportFusionError('没有可导入的合并表格，请先选择至少一个有效表格', null, { Logger, showNotification });
                    return;
                }

                const validation = validateFusionTemplate(mergeResult.mergedTemplate, { name: '合并模板' });
                if (!validation.templateImportable) {
                    reportFusionError(`合并结果未通过模板导入校验：${validation.invalidReason || '存在无效表格'}`, null, { Logger, showNotification });
                    return;
                }

                const importOptions = getTemplateImportOptions(container);
                const importResult = await importTemplateFromDataViaApi(mergeResult.mergedTemplate, importOptions);
                if (!importResult.ok) {
                    reportFusionError(`导入模板失败：${importResult.message || importResult.code || '数据库 API 未确认成功'}`, importResult.error, { Logger, showNotification });
                    return;
                }

                const successText = getTemplateImportSuccessText(importResult, importOptions);
                const refreshResult = await refreshDatabaseProjectionViaApi();
                if (!refreshResult.ok) {
                    Logger?.warn?.('[phone-fusion] 模板已导入，但刷新数据库投影失败', refreshResult);
                    showNotification?.(`${successText}，但刷新数据库投影失败：${refreshResult.message || refreshResult.code || '未知错误'}。可手动刷新。`, 'warning');
                    return;
                }

                showNotification?.(`${successText}，数据库投影已刷新`, 'success');
            } finally {
                if (importButton) importButton.disabled = false;
            }
        };

        runtimeApi.addEventListener(container.querySelector('.phone-nav-back'), 'click', navigateBack);
        runtimeApi.addEventListener(container.querySelector('#phone-use-builtin-a'), 'click', onUseBuiltinA);
        runtimeApi.addEventListener(container.querySelector('#phone-use-current-db-b'), 'click', onUseCurrentDatabaseB);
        runtimeApi.addEventListener(container.querySelector('#phone-import-a'), 'click', onImportA);
        runtimeApi.addEventListener(container.querySelector('#phone-import-b'), 'click', onImportB);
        runtimeApi.addEventListener(container.querySelector('#phone-fusion-merge'), 'click', () => {
            performMerge(container);
        });
        runtimeApi.addEventListener(container.querySelector('#phone-fusion-import-template'), 'click', onImportTemplate);

        const cleanup = () => runtimeApi.disposeFallback?.();
        runtimeApi.registerCleanup?.(cleanup);
        return cleanup;
    };

    const reset = () => {
        sourceA = null;
        sourceB = null;
        sourceAName = '';
        sourceBName = '';
    };

    return {
        bind,
        reset,
        tryRenderCompare,
        performMerge,
        getState() {
            return { sourceA, sourceB, sourceAName, sourceBName };
        },
    };
}
