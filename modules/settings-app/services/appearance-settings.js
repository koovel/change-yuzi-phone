import { setupBgUpload as setupBgUploadImpl } from './appearance-settings/background-service.js';
import { createIconUploadService } from './appearance-settings/icon-upload-service.js';
import {
    renderHiddenTableAppsList as renderHiddenTableAppsListImpl,
    setupAppearanceToggles as setupAppearanceTogglesImpl,
} from './appearance-settings/visibility-settings.js';
import {
    getLayoutValue as getLayoutValueImpl,
    setupIconLayoutSettings as setupIconLayoutSettingsImpl,
} from './appearance-settings/layout-settings.js';
import {
    applyAppearanceResourcePack as applyAppearanceResourcePackImpl,
    clearAppearanceResourcePoolIcons as clearAppearanceResourcePoolIconsImpl,
    exportAppearanceResourcePack as exportAppearanceResourcePackImpl,
    importAppearanceResourcePackFromData as importAppearanceResourcePackFromDataImpl,
    validateAppearanceResourcePack as validateAppearanceResourcePackImpl,
} from './appearance-settings/resource-pack-service.js';
import {
    deleteAppearancePack as deleteAppearancePackImpl,
    getAppearancePack as getAppearancePackImpl,
    getAppearancePackRepositoryStats as getAppearancePackRepositoryStatsImpl,
    listAppearancePacks as listAppearancePacksImpl,
    saveAppearancePack as saveAppearancePackImpl,
} from './appearance-settings/appearance-pack-repository.js';
import { flushPhoneSettingsSave, getPhoneSettings, savePhoneSettingsPatch } from '../../settings.js';
import {
    applyAppearanceFontLibrary as applyAppearanceFontLibraryImpl,
    deleteAppearanceFont as deleteAppearanceFontImpl,
    getAppearanceFontLibraryViewModel as getAppearanceFontLibraryViewModelImpl,
    importAppearanceFontCssUrl as importAppearanceFontCssUrlImpl,
    importAppearanceFontFile as importAppearanceFontFileImpl,
    selectAppearanceFont as selectAppearanceFontImpl,
} from './appearance-settings/font-library-service.js';
import {
    applyReadableTextScale as applyReadableTextScaleImpl,
    getReadableTextScalePercentValue as getReadableTextScalePercentValueImpl,
    setupReadableTextScaleSettings as setupReadableTextScaleSettingsImpl,
} from './appearance-settings/readable-text-scale-settings.js';
import {
    getHomeAppLabelColorModeValue as getHomeAppLabelColorModeValueImpl,
    setupHomeAppLabelColorSettings as setupHomeAppLabelColorSettingsImpl,
} from './appearance-settings/home-label-color-settings.js';
import {
    applyPhoneThemeMode as applyPhoneThemeModeImpl,
    getPhoneThemeModeValue as getPhoneThemeModeValueImpl,
    setupPhoneThemeModeSettings as setupPhoneThemeModeSettingsImpl,
} from './appearance-settings/theme-settings.js';

const { renderIconUploadList: renderIconUploadListImpl } = createIconUploadService();

export function setupBgUpload(container, options = {}) {
    return setupBgUploadImpl(container, options);
}

export function renderIconUploadList(listEl, options = {}) {
    return renderIconUploadListImpl(listEl, options);
}

export function setupAppearanceToggles(container) {
    return setupAppearanceTogglesImpl(container);
}

export function renderHiddenTableAppsList(listEl) {
    return renderHiddenTableAppsListImpl(listEl);
}

export function setupIconLayoutSettings(container) {
    return setupIconLayoutSettingsImpl(container);
}

export function importAppearanceResourcePackFromData(input, options = {}) {
    return importAppearanceResourcePackFromDataImpl(input, options);
}

export function validateAppearanceResourcePack(input) {
    return validateAppearanceResourcePackImpl(input);
}

export function applyAppearanceResourcePack(packInput, options = {}) {
    return applyAppearanceResourcePackImpl(packInput, options);
}

export async function listAppearancePacks() {
    return await listAppearancePacksImpl();
}

export async function getAppearancePack(id) {
    return await getAppearancePackImpl(id);
}

export async function saveAppearancePack(packInput, options = {}) {
    return await saveAppearancePackImpl(packInput, options);
}

export async function deleteAppearancePack(id) {
    return await deleteAppearancePackImpl(id);
}

export async function getAppearancePackRepositoryStats() {
    return await getAppearancePackRepositoryStatsImpl();
}

export async function importAppearancePackToRepository(fileText, meta = {}) {
    return await saveAppearancePackImpl(fileText, meta);
}

export async function applyAppearancePackFromRepository(id) {
    const entryResult = await getAppearancePackImpl(id);
    if (!entryResult?.success || !entryResult.pack) {
        return entryResult;
    }
    return applyAppearanceResourcePackImpl(entryResult.pack, { activePackId: entryResult.meta?.id || id });
}

export async function deleteAppearancePackFromRepository(id) {
    const settings = getPhoneSettings();
    const activePackId = String(settings?.appearanceActivePackId || '').trim();
    const targetPackId = String(id || '').trim();

    if (activePackId && activePackId === targetPackId) {
        const clearResult = savePhoneSettingsPatch({ appearanceActivePackId: '' });
        if (!clearResult) {
            return {
                success: false,
                message: '删除失败：当前激活标记清理失败，仓库包未删除；当前外观未被清空',
                deletedId: '',
                activeCleared: false,
            };
        }
        const flushResult = flushPhoneSettingsSave();
        if (!flushResult) {
            savePhoneSettingsPatch({ appearanceActivePackId: activePackId });
            flushPhoneSettingsSave();
            return {
                success: false,
                message: '删除失败：当前激活标记无法持久化，仓库包未删除；当前外观未被清空',
                deletedId: '',
                activeCleared: false,
            };
        }

        const deleteResult = await deleteAppearancePackImpl(id);
        if (!deleteResult?.success) {
            savePhoneSettingsPatch({ appearanceActivePackId: activePackId });
            const restoreFlushResult = flushPhoneSettingsSave();
            if (!restoreFlushResult) {
                return { ...deleteResult, message: `${deleteResult.message || '删除失败'}；当前激活标记恢复保存失败`, activeCleared: false };
            }
            return { ...deleteResult, activeCleared: false };
        }
        return { ...deleteResult, activeCleared: true };
    }

    const deleteResult = await deleteAppearancePackImpl(id);
    if (!deleteResult?.success) {
        return deleteResult;
    }

    return { ...deleteResult, activeCleared: false };
}

export function exportAppearanceResourcePack(options = {}) {
    return exportAppearanceResourcePackImpl(options);
}

export function clearAppearanceResourcePoolIcons() {
    return clearAppearanceResourcePoolIconsImpl();
}

export function getAppearanceFontLibraryViewModel() {
    return getAppearanceFontLibraryViewModelImpl();
}

export function importAppearanceFontFile(file) {
    return importAppearanceFontFileImpl(file);
}

export function importAppearanceFontCssUrl(input) {
    return importAppearanceFontCssUrlImpl(input);
}

export function selectAppearanceFont(fontId) {
    return selectAppearanceFontImpl(fontId);
}

export function deleteAppearanceFont(fontId) {
    return deleteAppearanceFontImpl(fontId);
}

export function applyAppearanceFontLibrary(root = null) {
    return applyAppearanceFontLibraryImpl(root);
}

export function getReadableTextScalePercentValue() {
    return getReadableTextScalePercentValueImpl();
}

export function applyReadableTextScale(root = null, percent) {
    return applyReadableTextScaleImpl(root, percent);
}

export function setupReadableTextScaleSettings(container) {
    return setupReadableTextScaleSettingsImpl(container);
}

export function getHomeAppLabelColorModeValue() {
    return getHomeAppLabelColorModeValueImpl();
}

export function setupHomeAppLabelColorSettings(container) {
    return setupHomeAppLabelColorSettingsImpl(container);
}

export function getLayoutValue(key, fallback) {
    return getLayoutValueImpl(key, fallback);
}

export function getPhoneThemeModeValue() {
    return getPhoneThemeModeValueImpl();
}

export function applyPhoneThemeMode(mode) {
    return applyPhoneThemeModeImpl(mode);
}

export function setupPhoneThemeModeSettings(container) {
    return setupPhoneThemeModeSettingsImpl(container);
}
