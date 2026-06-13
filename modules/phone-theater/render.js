import { getTableData } from '../phone-core/data-api.js';
import { navigateBack } from '../phone-core/routing.js';
import { getPhoneCoreState, phoneRuntime } from '../phone-core/state.js';
import { createRuntimeScrollPreserver } from '../ui-runtime/scroll-preserver-core.js';
import { buildTheaterSceneViewModel } from './data.js';
import { buildTheaterScenePageHtml } from './templates.js';
import { bindTheaterSceneInteractions } from './interactions.js';

function normalizeText(value) {
    return String(value ?? '').trim();
}

/**
 * 自动检测新增行：比较当前最大 row_id 与上次已知最大值，
 * 若增长了则将新行标记为"修改/添加行"以便排在第 1 页。
 */
function autoDetectNewRows(rawData, sceneId) {
    if (!rawData) return;
    const scene = getTheaterSceneDefinition(sceneId);
    if (!scene) return;
    const primaryTableName = normalizeText(scene.primaryTableName);
    if (!primaryTableName) return;

    const sheetKeys = Object.keys(rawData).filter(key => key.startsWith('sheet_'));
    let sheet = null;
    for (const key of sheetKeys) {
        if (normalizeText(rawData[key]?.name) === primaryTableName) {
            sheet = rawData[key];
            break;
        }
    }
    if (!sheet || !Array.isArray(sheet.content) || sheet.content.length <= 1) return;

    const headers = Array.isArray(sheet.content[0]) ? sheet.content[0] : [];
    const rowIdColIndex = headers.findIndex(h => normalizeText(h) === 'row_id');
    if (rowIdColIndex < 0) return;

    let maxId = null;
    for (let i = 1; i < sheet.content.length; i++) {
        const value = normalizeText(sheet.content[i]?.[rowIdColIndex]);
        if (value) {
            const numId = Number(value);
            if (Number.isFinite(numId) && (maxId === null || numId > maxId)) {
                maxId = numId;
            }
        }
    }
    if (maxId === null) return;

    const newMaxRowId = String(maxId);
    const lastKnownMax = getLastKnownMaxRowId(primaryTableName);

    if (lastKnownMax !== null) {
        const lastNum = Number(lastKnownMax);
        const newNum = Number(newMaxRowId);
        if (Number.isFinite(lastNum) && Number.isFinite(newNum) && newNum > lastNum) {
            const existingModified = getModifiedRowId(primaryTableName);
            if (!existingModified) {
                setModifiedRow(primaryTableName, newMaxRowId);
            }
        }
    }

    setLastKnownMaxRowId(primaryTableName, newMaxRowId);
}

function normalizeRenderToken(value) {
    const token = Number(value);
    return Number.isFinite(token) ? token : null;
}

function createTheaterLifecycleContext(container, sceneId, options = {}) {
    const expectedSceneId = normalizeText(sceneId);
    const renderToken = normalizeRenderToken(options.renderToken);
    const allowDetachedInitialRender = options.allowDetachedInitialRender !== false;
    return Object.freeze({
        renderToken,
        sceneId: expectedSceneId,
        phoneRuntime,
        runtime: phoneRuntime,
        addEventListener: (...args) => phoneRuntime.addEventListener(...args),
        setTimeout: (...args) => phoneRuntime.setTimeout(...args),
        clearTimeout: (...args) => phoneRuntime.clearTimeout(...args),
        registerCleanup: (...args) => phoneRuntime.registerCleanup(...args),
        isDisposed: () => typeof phoneRuntime?.isDisposed === 'function' && phoneRuntime.isDisposed(),
        isActive(activeOptions = {}) {
            const allowDetached = activeOptions.allowDetached === true && allowDetachedInitialRender;
            if (!(container instanceof HTMLElement)) return false;
            if (!allowDetached && !container.isConnected) return false;
            if (typeof phoneRuntime?.isDisposed === 'function' && phoneRuntime.isDisposed()) return false;
            if (container.__phoneTheaterSceneState?.sceneId !== expectedSceneId) return false;
            if (renderToken !== null && getPhoneCoreState().routeRenderToken !== renderToken) return false;
            return true;
        },
    });
}

function createInitialState(sceneId) {
    return {
        sceneId: normalizeText(sceneId),
        deleteManageMode: false,
        selectedKeys: new Set(),
        deleting: false,
        bodyScrollTop: 0,
        editMenuOpen: false,
    };
}

function getTheaterRenderState(container, sceneId) {
    const normalizedSceneId = normalizeText(sceneId);
    if (!container.__phoneTheaterSceneState || container.__phoneTheaterSceneState.sceneId !== normalizedSceneId) {
        container.__phoneTheaterSceneState = createInitialState(normalizedSceneId);
    }
    const state = container.__phoneTheaterSceneState;
    if (!(state.selectedKeys instanceof Set)) {
        state.selectedKeys = new Set(Array.isArray(state.selectedKeys) ? state.selectedKeys.map(normalizeText).filter(Boolean) : []);
    }
    return state;
}

function collectDeletableKeys(viewModel) {
    const collector = viewModel?.scene?.collectDeletableKeys;
    const keys = typeof collector === 'function' ? collector(viewModel) : [];
    return [...new Set((Array.isArray(keys) ? keys : []).map(normalizeText).filter(Boolean))];
}

function buildUiState(state, viewModel) {
    const deletableKeys = collectDeletableKeys(viewModel);
    const availableKeys = new Set(deletableKeys);
    state.selectedKeys = new Set([...state.selectedKeys].filter(key => availableKeys.has(key)));
    const editableTables = Array.isArray(viewModel?.editableTables) ? viewModel.editableTables : [];
    const canDelete = deletableKeys.length > 0 && viewModel?.scene?.deletable !== false;
    const canEdit = editableTables.some(entry => entry?.available);
    if (!canDelete && state.deleteManageMode) {
        state.deleteManageMode = false;
        state.selectedKeys.clear();
    }
    if (!canEdit && state.editMenuOpen) {
        state.editMenuOpen = false;
    }
    return {
        deleteManageMode: !!state.deleteManageMode,
        selectedKeys: state.selectedKeys,
        selectedCount: state.selectedKeys.size,
        totalCount: deletableKeys.length,
        deleting: !!state.deleting,
        canDelete,
        canEdit,
        editMenuOpen: !!state.editMenuOpen,
        editableTables,
    };
}

function bindTheaterSceneEvents(container, lifecycle) {
    const backButton = container.querySelector('.phone-nav-back');
    if (!(backButton instanceof HTMLElement)) return;

    const runtime = lifecycle?.runtime;
    if (runtime && typeof runtime.addEventListener === 'function' && typeof runtime.isDisposed === 'function' && !runtime.isDisposed()) {
        runtime.addEventListener(backButton, 'click', navigateBack);
        return;
    }

    backButton.addEventListener('click', navigateBack);
}

export function renderTheaterScene(container, sceneId, options = {}) {
    if (!(container instanceof HTMLElement)) return;

    const state = getTheaterRenderState(container, sceneId);
    const lifecycle = createTheaterLifecycleContext(container, state.sceneId, options);
    const scrollPreserver = createRuntimeScrollPreserver(container, state, '.phone-app-body.phone-theater-body', phoneRuntime);
    const hasExistingScrollableBody = !!container.querySelector('.phone-app-body.phone-theater-body');
    const prevContainerHeight = Math.max(0, container.offsetHeight || 0);
    const renderCurrentScene = () => {
        if (!lifecycle.isActive()) return;
        renderTheaterScene(container, state.sceneId, options);
    };
    const rawData = getTableData();
    autoDetectNewRows(rawData, state.sceneId);
    const viewModel = buildTheaterSceneViewModel(rawData, state.sceneId);
    const uiState = buildUiState(state, viewModel);

    if (!lifecycle.isActive({ allowDetached: true })) return;

    if (hasExistingScrollableBody) {
        scrollPreserver.captureScroll('bodyScrollTop');
        if (prevContainerHeight > 0) {
            container.style.minHeight = `${prevContainerHeight}px`;
        }
    }

    try {
        container.innerHTML = buildTheaterScenePageHtml(viewModel, uiState);
        bindTheaterSceneEvents(container, lifecycle);
        bindTheaterSceneInteractions(container, {
            scene: viewModel.scene,
            sceneId: state.sceneId,
            state,
            viewModel,
            render: renderCurrentScene,
            lifecycle,
        });
    } finally {
        if (hasExistingScrollableBody) {
            scrollPreserver.restoreScroll('bodyScrollTop');
            phoneRuntime.requestAnimationFrame(() => {
                phoneRuntime.requestAnimationFrame(() => {
                    if (!container.isConnected) return;
                    container.style.removeProperty('min-height');
                });
            });
        }
    }
}
import { getTheaterSceneDefinition } from './config.js';
import { setModifiedRow, getModifiedRowId, getLastKnownMaxRowId, setLastKnownMaxRowId } from './core/row-tracker.js';
