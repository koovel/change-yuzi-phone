import { escapeHtml, escapeHtmlAttr } from '../utils/dom-escape.js';
import { PHONE_ICONS } from '../phone-home/icons.js';
import { theaterRenderKit } from './core/render-kit.js';

function renderEditMenu(editableTables = []) {
    const entries = editableTables.filter(entry => entry?.available);
    if (entries.length <= 1) return '';
    return `
        <div class="phone-theater-edit-menu" role="menu">
            ${entries.map((entry) => `
                <button type="button" class="phone-theater-edit-menu-item" data-action="theater-open-edit-table" data-edit-role="${escapeHtmlAttr(entry.role)}" role="menuitem">
                    <span>${escapeHtml(entry.label || entry.tableName || '编辑表格')}</span>
                    ${entry.description ? `<small>${escapeHtml(entry.description)}</small>` : ''}
                </button>
            `).join('')}
        </div>
    `;
}

function renderNavActions(uiState = {}) {
    const deleteMode = !!uiState.deleteManageMode;
    const deleting = !!uiState.deleting;
    const editableTables = Array.isArray(uiState.editableTables) ? uiState.editableTables : [];
    const canEdit = !!uiState.canEdit;
    const canDelete = !!uiState.canDelete;
    const editMenuOpen = !!uiState.editMenuOpen;
    const editButtonLabel = editableTables.filter(entry => entry?.available).length > 1 && editMenuOpen ? '收起' : '编辑';

    if (!canEdit && !canDelete) return '<div class="phone-theater-nav-actions" aria-hidden="true"></div>';

    return `
        <div class="phone-theater-nav-actions">
            ${canEdit ? `
                <div class="phone-theater-edit-wrapper ${editMenuOpen ? 'is-open' : ''}">
                    <button type="button" class="phone-theater-edit-toggle" data-action="toggle-theater-edit-menu" aria-expanded="${editMenuOpen ? 'true' : 'false'}">${editButtonLabel}</button>
                    ${editMenuOpen ? renderEditMenu(editableTables) : ''}
                </div>
            ` : ''}
            ${canDelete ? `<button type="button" class="phone-theater-delete-toggle ${deleteMode ? 'is-active' : ''}" data-action="toggle-theater-delete-mode" ${deleting ? 'disabled' : ''}>${deleteMode ? '完成' : '删除'}</button>` : ''}
        </div>
    `;
}

function renderNav(title, uiState = {}) {
    return `
        <div class="phone-nav-bar phone-theater-nav">
            <button type="button" class="phone-nav-back">${PHONE_ICONS.back}<span>返回</span></button>
            <span class="phone-nav-title">${escapeHtml(title || '小剧场')}</span>
            ${renderNavActions(uiState)}
        </div>
    `;
}

function renderDeleteManageBar(uiState = {}) {
    if (!uiState.deleteManageMode) return '';
    const selectedCount = Number(uiState.selectedCount || 0);
    const totalCount = Number(uiState.totalCount || 0);
    const deleting = !!uiState.deleting;
    return `
        <div class="phone-theater-manage-bar">
            <button type="button" class="phone-theater-manage-btn" data-action="theater-select-all" ${deleting || totalCount <= 0 ? 'disabled' : ''}>全选</button>
            <button type="button" class="phone-theater-manage-btn" data-action="theater-clear-selection" ${deleting || selectedCount <= 0 ? 'disabled' : ''}>取消选择</button>
            <button type="button" class="phone-theater-manage-btn is-danger" data-action="theater-confirm-delete" ${deleting || selectedCount <= 0 ? 'disabled' : ''}>${deleting ? '删除中...' : `删除已选（${selectedCount}）`}</button>
        </div>
    `;
}

function renderSceneContent(viewModel, uiState = {}) {
    if (!viewModel?.available) return theaterRenderKit.renderEmpty(viewModel?.emptyText || '暂无内容');
    const renderContent = viewModel?.scene?.renderContent;
    if (typeof renderContent !== 'function') return theaterRenderKit.renderEmpty('未知小剧场入口');
    return renderContent(viewModel, uiState, theaterRenderKit);
}

export function buildTheaterScenePageHtml(viewModel, uiState = {}) {
    const title = viewModel?.title || '小剧场';
    const sceneId = viewModel?.scene?.id || '';
    const styleScope = viewModel?.scene?.styleScope || sceneId;
    return `
        <div class="phone-app-page phone-theater-page ${uiState.deleteManageMode ? 'is-theater-delete-mode' : ''}" data-theater-scene="${escapeHtmlAttr(sceneId)}" data-theater-style-scope="${escapeHtmlAttr(styleScope)}">
            ${renderNav(title, uiState)}
            <div class="phone-app-body phone-theater-body">
                ${renderDeleteManageBar(uiState)}
                ${renderSceneContent(viewModel, uiState)}
            </div>
        </div>
    `;
}
