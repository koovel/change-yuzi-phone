import { getTableData } from '../../../phone-core/data-api.js';
import {
    getPhoneSettings,
    savePhoneSettingsPatch,
    flushPhoneSettingsSave,
    normalizeAppearanceResourcePoolSettings,
} from '../../../settings.js';
import { STORAGE_BUDGETS } from '../../constants.js';
import {
    estimateBase64Bytes,
    estimateIconsStorageBytes,
} from '../media-upload.js';
import { collectAppearanceIconSlots } from './icon-slots.js';

export const APPEARANCE_PACK_FORMAT = 'yuzi-phone-appearance-pack';
export const APPEARANCE_PACK_SCHEMA_VERSION = 1;
export const APPEARANCE_PACK_MIN_COMPAT_SCHEMA_VERSION = 1;

const IMAGE_MIME_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
]);

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeString(value, maxLength = 256) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function parsePackInput(input) {
    if (typeof input === 'string') {
        return JSON.parse(input);
    }
    if (isPlainObject(input)) {
        return input;
    }
    throw new Error('外观包必须是 JSON 对象');
}

function normalizeImageResource(raw, index = 0, kind = 'resource') {
    if (!isPlainObject(raw)) return null;
    const dataUrl = safeString(raw.dataUrl, Number.MAX_SAFE_INTEGER);
    const match = dataUrl.match(/^data:([^;,]+)[;,]/i);
    const mime = safeString(raw.mime || match?.[1], 64).toLowerCase();
    if (!dataUrl || !mime || !IMAGE_MIME_TYPES.has(mime) || !dataUrl.startsWith(`data:${mime}`)) {
        return null;
    }

    const bytes = estimateBase64Bytes(dataUrl);
    const fallbackId = `${kind}_${index + 1}`;
    const id = safeString(raw.id, 96) || fallbackId;
    const hash = safeString(raw.hash, 160) || computeResourceHash(dataUrl);

    return {
        id,
        name: safeString(raw.name, 120) || id,
        mime,
        dataUrl,
        hash,
        bytes,
        width: Number.isFinite(Number(raw.width)) ? Math.max(0, Math.round(Number(raw.width))) : 0,
        height: Number.isFinite(Number(raw.height)) ? Math.max(0, Math.round(Number(raw.height))) : 0,
        source: safeString(raw.source || 'pack', 48) || 'pack',
    };
}

function computeResourceHash(dataUrl) {
    const source = String(dataUrl || '');
    let hash = 5381;
    for (let i = 0; i < source.length; i += 1) {
        hash = ((hash << 5) + hash) ^ source.charCodeAt(i);
        hash >>>= 0;
    }
    return `djb2:${hash.toString(16).padStart(8, '0')}:${source.length}`;
}

function dedupeResources(resources) {
    const used = new Set();
    const normalized = [];
    resources.forEach((resource) => {
        const key = resource?.hash || resource?.dataUrl;
        if (!resource || !key || used.has(key)) return;
        used.add(key);
        normalized.push(resource);
    });
    return normalized;
}

function normalizeResourceList(list, kind) {
    if (!Array.isArray(list)) return [];
    return dedupeResources(
        list.map((item, index) => normalizeImageResource(item, index, kind)).filter(Boolean),
    );
}

function validatePack(pack) {
    if (!isPlainObject(pack)) {
        throw new Error('外观包必须是对象');
    }
    if (pack.format !== APPEARANCE_PACK_FORMAT) {
        throw new Error(`外观包 format 必须是 ${APPEARANCE_PACK_FORMAT}`);
    }

    const schemaVersion = Number(pack.schemaVersion || 0);
    if (!Number.isFinite(schemaVersion) || schemaVersion < APPEARANCE_PACK_MIN_COMPAT_SCHEMA_VERSION) {
        throw new Error('外观包 schemaVersion 过旧或无效');
    }
    if (schemaVersion > APPEARANCE_PACK_SCHEMA_VERSION) {
        throw new Error(`外观包 schemaVersion=${schemaVersion} 高于当前支持版本 ${APPEARANCE_PACK_SCHEMA_VERSION}`);
    }

    return {
        ...pack,
        schemaVersion,
        wallpapers: normalizeResourceList(pack.wallpapers, 'wallpaper'),
        icons: normalizeResourceList(pack.icons, 'icon'),
        iconPool: normalizeResourceList(pack.iconPool, 'icon'),
        preferences: isPlainObject(pack.preferences) ? pack.preferences : {},
    };
}

function mergeResourcePool(currentPool, incoming = {}) {
    const normalizedCurrent = normalizeAppearanceResourcePoolSettings(currentPool);
    const wallpapers = dedupeResources([
        ...normalizedCurrent.wallpapers,
        ...(Array.isArray(incoming.wallpapers) ? incoming.wallpapers : []),
    ]);
    const icons = dedupeResources([
        ...normalizedCurrent.icons,
        ...(Array.isArray(incoming.icons) ? incoming.icons : []),
    ]);
    return normalizeAppearanceResourcePoolSettings({ wallpapers, icons });
}

function shuffleStable(items, seedText = '') {
    const copy = [...items];
    let seed = 2166136261;
    const text = String(seedText || 'yuzi-phone');
    for (let i = 0; i < text.length; i += 1) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619) >>> 0;
    }
    for (let i = copy.length - 1; i > 0; i -= 1) {
        seed = Math.imul(seed ^ i, 1664525) + 1013904223;
        seed >>>= 0;
        const j = seed % (i + 1);
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
    }
    return copy;
}

function buildIconAssignment({ iconSlots, currentIcons, packIcons, overwriteExisting, seedText }) {
    const nextIcons = { ...(currentIcons || {}) };
    const assignableSlots = iconSlots.filter((slot) => overwriteExisting || !nextIcons[slot.key]);
    const shuffledIcons = shuffleStable(packIcons, seedText);
    const assigned = [];
    const leftovers = [];

    shuffledIcons.forEach((icon, index) => {
        const slot = assignableSlots[index];
        if (!slot) {
            leftovers.push(icon);
            return;
        }
        nextIcons[slot.key] = icon.dataUrl;
        assigned.push({ slotKey: slot.key, slotName: slot.name, resourceId: icon.id });
    });

    return { nextIcons, assigned, leftovers };
}

function createExportResource({ id, name, dataUrl, source = 'settings' }) {
    const normalized = normalizeImageResource({
        id,
        name,
        dataUrl,
        source,
    }, 0, 'export');
    return normalized;
}

function collectActiveIconKeys() {
    const rawData = getTableData();
    if (!rawData) {
        return { keys: new Set(), available: false };
    }

    const slots = collectAppearanceIconSlots(rawData);
    return {
        keys: new Set(slots.map((slot) => slot.key).filter(Boolean)),
        available: true,
    };
}

function splitAppIconsByActiveSlots(appIcons, activeKeys) {
    const activeIcons = {};
    const orphanIcons = {};
    Object.entries(appIcons || {}).forEach(([key, dataUrl]) => {
        if (activeKeys.has(key)) {
            activeIcons[key] = dataUrl;
        } else {
            orphanIcons[key] = dataUrl;
        }
    });
    return { activeIcons, orphanIcons };
}

export function clearAppearanceResourcePoolIcons() {
    const settings = getPhoneSettings();
    const pool = normalizeAppearanceResourcePoolSettings(settings.appearanceResourcePool);
    const activeKeyResult = collectActiveIconKeys();
    const currentAppIcons = settings.appIcons || {};
    const { activeIcons, orphanIcons } = activeKeyResult.available
        ? splitAppIconsByActiveSlots(currentAppIcons, activeKeyResult.keys)
        : { activeIcons: currentAppIcons, orphanIcons: {} };
    const removedPoolIcons = Array.isArray(pool.icons) ? pool.icons.length : 0;
    const removedOrphanAppIcons = Object.keys(orphanIcons).length;
    const removedCount = removedPoolIcons + removedOrphanAppIcons;

    if (removedCount <= 0) {
        return {
            success: false,
            removedCount: 0,
            removedPoolIcons: 0,
            removedOrphanAppIcons: 0,
            skippedOrphanCleanup: !activeKeyResult.available,
            message: activeKeyResult.available ? '未发现可清理的未使用图标' : '未发现可清理的资源池图标，当前数据不可用，已跳过未使用图标扫描',
        };
    }

    const patch = {
        appearanceResourcePool: {
            wallpapers: pool.wallpapers,
            icons: [],
        },
    };
    if (removedOrphanAppIcons > 0) {
        patch.appIcons = activeIcons;
    }

    const saved = savePhoneSettingsPatch(patch);

    if (!saved) {
        return {
            success: false,
            removedCount: 0,
            removedPoolIcons: 0,
            removedOrphanAppIcons: 0,
            skippedOrphanCleanup: !activeKeyResult.available,
            message: '未使用图标清理失败：设置保存失败',
        };
    }

    flushPhoneSettingsSave();
    return {
        success: true,
        removedCount,
        removedPoolIcons,
        removedOrphanAppIcons,
        skippedOrphanCleanup: !activeKeyResult.available,
        message: `已清理未使用图标 ${removedCount} 个（资源池 ${removedPoolIcons} 个，隐藏旧图标 ${removedOrphanAppIcons} 个）`,
    };
}

export function exportAppearanceResourcePack(options = {}) {
    const settings = getPhoneSettings();
    const pool = normalizeAppearanceResourcePoolSettings(settings.appearanceResourcePool);
    const wallpapers = [];
    const icons = [];

    if (settings.backgroundImage) {
        const currentWallpaper = createExportResource({
            id: 'current-background',
            name: '当前背景',
            dataUrl: settings.backgroundImage,
            source: 'current',
        });
        if (currentWallpaper) wallpapers.push(currentWallpaper);
    }
    wallpapers.push(...pool.wallpapers);

    Object.entries(settings.appIcons || {}).forEach(([key, dataUrl]) => {
        const icon = createExportResource({
            id: `current-icon-${key}`,
            name: `当前图标 ${key}`,
            dataUrl,
            source: 'current',
        });
        if (icon) icons.push(icon);
    });
    icons.push(...pool.icons);

    const packName = safeString(options.packName, 120) || '玉子手机外观资源包';
    return {
        success: true,
        pack: {
            format: APPEARANCE_PACK_FORMAT,
            schemaVersion: APPEARANCE_PACK_SCHEMA_VERSION,
            minCompatSchemaVersion: APPEARANCE_PACK_MIN_COMPAT_SCHEMA_VERSION,
            packMeta: {
                name: packName,
                exportedAt: new Date().toISOString(),
                exporter: 'YuziPhone',
            },
            wallpapers: dedupeResources(wallpapers),
            icons: dedupeResources(icons),
            iconPool: [],
            preferences: {
                wallpaperStrategy: 'first',
                iconAssignStrategy: 'random-empty',
                overwriteExistingIcons: false,
            },
        },
    };
}

export function importAppearanceResourcePackFromData(input, options = {}) {
    const warnings = [];
    try {
        const pack = validatePack(parsePackInput(input));
        const currentSettings = getPhoneSettings();
        const overwriteExisting = options.overwriteExistingIcons === true
            || pack.preferences?.overwriteExistingIcons === true
            || pack.preferences?.iconAssignStrategy === 'random-overwrite';
        const iconSlots = collectAppearanceIconSlots();
        const packIcons = dedupeResources([...pack.icons, ...pack.iconPool]);
        const wallpaper = pack.wallpapers[0] || null;

        if (wallpaper && wallpaper.bytes > STORAGE_BUDGETS.backgroundImageBytes) {
            return {
                success: false,
                imported: 0,
                assignedIcons: 0,
                poolIcons: 0,
                warnings,
                errors: ['背景图超过当前背景容量上限，未导入'],
                message: '导入失败：背景图过大',
            };
        }

        const oversizedIcon = packIcons.find(icon => icon.bytes > STORAGE_BUDGETS.appIconBytes);
        if (oversizedIcon) {
            return {
                success: false,
                imported: 0,
                assignedIcons: 0,
                poolIcons: 0,
                warnings,
                errors: [`图标“${oversizedIcon.name}”超过单图容量上限，未导入`],
                message: '导入失败：图标过大',
            };
        }

        const assignment = buildIconAssignment({
            iconSlots,
            currentIcons: currentSettings.appIcons || {},
            packIcons,
            overwriteExisting,
            seedText: `${pack.packMeta?.name || ''}:${pack.packMeta?.version || ''}:${packIcons.length}`,
        });
        const nextPool = mergeResourcePool(currentSettings.appearanceResourcePool, {
            wallpapers: wallpaper ? pack.wallpapers.slice(1) : pack.wallpapers,
            icons: assignment.leftovers,
        });
        const nextTotalIconBytes = estimateIconsStorageBytes(assignment.nextIcons) + nextPool.icons.reduce((sum, icon) => sum + Number(icon.bytes || 0), 0);

        if (nextTotalIconBytes > STORAGE_BUDGETS.appIconsTotalBytes) {
            return {
                success: false,
                imported: 0,
                assignedIcons: 0,
                poolIcons: 0,
                warnings,
                errors: ['导入后图标总容量超过上限，未导入'],
                message: '导入失败：图标总容量超限',
            };
        }

        if (iconSlots.length === 0 && packIcons.length > 0) {
            warnings.push('当前没有可分配图标位，图标已进入资源池');
        }

        const backup = {
            backgroundImage: currentSettings.backgroundImage || null,
            appIcons: { ...(currentSettings.appIcons || {}) },
            appearanceResourcePool: normalizeAppearanceResourcePoolSettings(currentSettings.appearanceResourcePool),
        };
        const patch = {
            backgroundImage: wallpaper ? wallpaper.dataUrl : backup.backgroundImage,
            appIcons: assignment.nextIcons,
            appearanceResourcePool: iconSlots.length === 0 && packIcons.length > 0
                ? mergeResourcePool(currentSettings.appearanceResourcePool, {
                    wallpapers: wallpaper ? pack.wallpapers.slice(1) : pack.wallpapers,
                    icons: packIcons,
                })
                : nextPool,
        };

        const saved = savePhoneSettingsPatch(patch);
        if (!saved) {
            savePhoneSettingsPatch(backup);
            flushPhoneSettingsSave();
            return {
                success: false,
                imported: 0,
                assignedIcons: 0,
                poolIcons: 0,
                warnings,
                errors: ['设置保存失败，已回滚'],
                message: '导入失败：设置保存失败',
            };
        }
        flushPhoneSettingsSave();

        return {
            success: true,
            imported: (wallpaper ? 1 : 0) + packIcons.length,
            assignedIcons: assignment.assigned.length,
            poolIcons: (patch.appearanceResourcePool.icons || []).length,
            warnings,
            errors: [],
            message: `导入完成：背景 ${wallpaper ? 1 : 0}，分配图标 ${assignment.assigned.length}，资源池图标 ${patch.appearanceResourcePool.icons.length}`,
        };
    } catch (error) {
        return {
            success: false,
            imported: 0,
            assignedIcons: 0,
            poolIcons: 0,
            warnings,
            errors: [error?.message || '未知错误'],
            message: `导入失败：${error?.message || '未知错误'}`,
        };
    }
}
