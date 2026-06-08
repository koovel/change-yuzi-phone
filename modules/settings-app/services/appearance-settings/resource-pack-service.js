import { getTableData } from '../../../phone-core/data-api.js';
import {
    getPhoneSettings,
    savePhoneSettingsPatch,
    flushPhoneSettingsSave,
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

function normalizeIconMatchName(value) {
    return safeString(value, 160);
}

function normalizeIconScoreName(value) {
    return safeString(value, 160)
        .replace(/[\s\u3000]+/g, '')
        .replace(/[（）()【】\[\]{}「」『』]/g, '')
        .replace(/表$/u, '');
}

function tokenizeIconName(value) {
    const normalized = normalizeIconScoreName(value);
    if (!normalized) return [];
    return Array.from(new Set([
        normalized,
        ...normalized.split(/[与和及、,，/\\|]+/u).filter(Boolean),
    ]));
}

function countCommonCharacters(left, right) {
    const rightChars = new Map();
    Array.from(right).forEach((char) => {
        rightChars.set(char, (rightChars.get(char) || 0) + 1);
    });

    let count = 0;
    Array.from(left).forEach((char) => {
        const rest = rightChars.get(char) || 0;
        if (rest <= 0) return;
        count += 1;
        rightChars.set(char, rest - 1);
    });
    return count;
}

function scoreIconNameMatch(iconName, slotName) {
    const icon = normalizeIconScoreName(iconName);
    const slot = normalizeIconScoreName(slotName);
    if (!icon || !slot) return 0;

    if (icon === slot) return 100;

    const iconTokens = tokenizeIconName(iconName);
    const slotTokens = tokenizeIconName(slotName);
    if (iconTokens.includes(slot) || slotTokens.includes(icon)) return 92;

    if (icon.includes(slot) || slot.includes(icon)) {
        const shortLength = Math.min(icon.length, slot.length);
        const longLength = Math.max(icon.length, slot.length);
        return Math.round(80 + (shortLength / longLength) * 10);
    }

    const overlap = countCommonCharacters(icon, slot);
    const denominator = Math.max(icon.length, slot.length);
    const ratio = denominator > 0 ? overlap / denominator : 0;
    return Math.round(ratio * 70);
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
        ...(safeString(raw.slotKey, 160)
            ? { slotKey: safeString(raw.slotKey, 160) } : {}),
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

function dedupeResourcesByContent(resources) {
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

function dedupeIconSlotResources(resources) {
    const used = new Set();
    const normalized = [];
    resources.forEach((resource, index) => {
        if (!resource) return;
        const slotKey = safeString(resource.slotKey, 160);
        const key = slotKey
            ? `slot:${slotKey}`
            : `legacy:${resource.id || resource.hash || resource.dataUrl || index}`;
        if (used.has(key)) return;
        used.add(key);
        normalized.push(resource);
    });
    return normalized;
}

function normalizeResourceList(list, kind) {
    if (!Array.isArray(list)) return [];
    return dedupeResourcesByContent(
        list.map((item, index) => normalizeImageResource(item, index, kind)).filter(Boolean),
    );
}

function normalizeIconSlotResourceList(list, kind) {
    if (!Array.isArray(list)) return [];
    return dedupeIconSlotResources(
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
        icons: normalizeIconSlotResourceList(pack.icons, 'icon'),
        iconPool: normalizeResourceList(pack.iconPool, 'icon'),
        preferences: isPlainObject(pack.preferences) ? pack.preferences : {},
    };
}

function createEmptyAppearanceResourcePool() {
    return {
        wallpapers: [],
        icons: [],
    };
}

function buildSlotNameIndex(slots) {
    const nameIndex = new Map();
    slots.forEach((slot) => {
        const name = normalizeIconMatchName(slot?.name);
        if (!name) return;
        if (!nameIndex.has(name)) {
            nameIndex.set(name, []);
        }
        nameIndex.get(name).push(slot);
    });
    return nameIndex;
}

function buildReplacingIconAssignment({ iconSlots, packIcons }) {
    const slots = Array.isArray(iconSlots) ? iconSlots.filter(slot => slot?.key) : [];
    const slotNameIndex = buildSlotNameIndex(slots);
    const usedSlotKeys = new Set();
    const usedIconIndexes = new Set();
    const nextIcons = {};
    const assigned = [];
    const discarded = [];
    const unmatchedNameIcons = [];
    const scoreMatchedIcons = [];
    const sequentialFilledIcons = [];

    function assignIconToSlot(icon, iconIndex, slot, strategy, score = 0) {
        nextIcons[slot.key] = icon.dataUrl;
        usedSlotKeys.add(slot.key);
        usedIconIndexes.add(iconIndex);
        assigned.push({
            slotKey: slot.key,
            slotName: slot.name,
            resourceId: icon.id,
            strategy,
            score,
        });
    }

    function findFirstUnusedSlotByName(name) {
        const candidates = slotNameIndex.get(name) || [];
        return candidates.find(slot => !usedSlotKeys.has(slot.key)) || null;
    }

    packIcons.forEach((icon, iconIndex) => {
        const iconName = normalizeIconMatchName(icon?.name);
        if (!iconName) {
            unmatchedNameIcons.push(icon);
            return;
        }

        const nameSlot = findFirstUnusedSlotByName(iconName);
        if (!nameSlot) {
            unmatchedNameIcons.push(icon);
            return;
        }
        assignIconToSlot(icon, iconIndex, nameSlot, 'name-exact', 100);
    });

    const scoreCandidates = [];
    packIcons.forEach((icon, iconIndex) => {
        if (usedIconIndexes.has(iconIndex)) return;
        slots.forEach((slot, slotIndex) => {
            if (usedSlotKeys.has(slot.key)) return;
            const score = scoreIconNameMatch(icon?.name, slot?.name);
            if (score <= 0) return;
            scoreCandidates.push({ icon, iconIndex, slot, slotIndex, score });
        });
    });

    scoreCandidates
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            if (left.iconIndex !== right.iconIndex) return left.iconIndex - right.iconIndex;
            return left.slotIndex - right.slotIndex;
        })
        .forEach((candidate) => {
            if (usedIconIndexes.has(candidate.iconIndex)) return;
            if (usedSlotKeys.has(candidate.slot.key)) return;
            assignIconToSlot(candidate.icon, candidate.iconIndex, candidate.slot, 'name-score', candidate.score);
            scoreMatchedIcons.push(candidate.icon);
        });

    let remainingSlotIndex = 0;
    packIcons.forEach((icon, iconIndex) => {
        if (usedIconIndexes.has(iconIndex)) return;
        while (remainingSlotIndex < slots.length && usedSlotKeys.has(slots[remainingSlotIndex].key)) {
            remainingSlotIndex += 1;
        }
        const slot = slots[remainingSlotIndex];
        if (!slot) {
            discarded.push(icon);
            return;
        }
        assignIconToSlot(icon, iconIndex, slot, 'sequential-fill', 0);
        sequentialFilledIcons.push(icon);
        remainingSlotIndex += 1;
    });

    return {
        nextIcons,
        assigned,
        discarded,
        unmatchedNameIcons,
        scoreMatchedIcons,
        sequentialFilledIcons,
    };
}

function createExportResource({ id, name, dataUrl, source = 'settings', slotKey = '' }) {
    const normalized = normalizeImageResource({
        id,
        name,
        dataUrl,
        source,
        slotKey,
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
    const activeKeyResult = collectActiveIconKeys();
    const currentAppIcons = settings.appIcons || {};
    const { activeIcons, orphanIcons } = activeKeyResult.available
        ? splitAppIconsByActiveSlots(currentAppIcons, activeKeyResult.keys)
        : { activeIcons: currentAppIcons, orphanIcons: {} };
    const removedPoolIcons = Array.isArray(settings.appearanceResourcePool?.icons) ? settings.appearanceResourcePool.icons.length : 0;
    const removedOrphanAppIcons = Object.keys(orphanIcons).length;
    const removedCount = removedPoolIcons + removedOrphanAppIcons;

    if (removedCount <= 0) {
        return {
            success: false,
            removedCount: 0,
            removedPoolIcons: 0,
            removedOrphanAppIcons: 0,
            skippedOrphanCleanup: !activeKeyResult.available,
            message: activeKeyResult.available ? '未发现可清理的未使用图标' : '当前数据不可用，已跳过隐藏旧图标扫描',
        };
    }

    const patch = {
        appearanceResourcePool: createEmptyAppearanceResourcePool(),
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
        message: `已清理未使用图标 ${removedCount} 个（兼容旧资源 ${removedPoolIcons} 个，隐藏旧图标 ${removedOrphanAppIcons} 个）`,
    };
}

export function exportAppearanceResourcePack(options = {}) {
    const settings = getPhoneSettings();
    const slotNameMap = new Map(collectAppearanceIconSlots().map(slot => [slot.key, slot.name]));
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

    Object.entries(settings.appIcons || {}).forEach(([key, dataUrl]) => {
        const icon = createExportResource({
            id: `current-icon-${key}`,
            name: slotNameMap.get(key) || `当前图标 ${key}`,
            dataUrl,
            source: 'current',
            slotKey: key,
        });
        if (icon) icons.push(icon);
    });

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
            wallpapers: dedupeResourcesByContent(wallpapers),
            icons: dedupeIconSlotResources(icons),
            iconPool: [],
            preferences: {
                wallpaperStrategy: 'replace-current',
                iconAssignStrategy: 'slot-key-overwrite',
                overwriteExistingIcons: true,
                discardExtraIcons: true,
                clearMissingIconSlots: true,
            },
        },
    };
}

function createAppearancePackFailure(message, errors = [], warnings = [], extra = {}) {
    return {
        success: false,
        imported: 0,
        assignedIcons: 0,
        poolIcons: 0,
        discardedIcons: 0,
        unmatchedIcons: 0,
        warnings,
        errors,
        message,
        ...extra,
    };
}

export function validateAppearanceResourcePack(input) {
    try {
        const pack = validatePack(parsePackInput(input));
        const packIcons = [
            ...pack.icons,
            ...dedupeResourcesByContent(pack.iconPool),
        ];
        const wallpaper = pack.wallpapers[0] || null;

        if (wallpaper && wallpaper.bytes > STORAGE_BUDGETS.backgroundImageBytes) {
            return createAppearancePackFailure('导入失败：背景图过大', ['背景图超过当前背景容量上限，未导入']);
        }

        const oversizedIcon = packIcons.find(icon => icon.bytes > STORAGE_BUDGETS.appIconBytes);
        if (oversizedIcon) {
            return createAppearancePackFailure('导入失败：图标过大', [`图标“${oversizedIcon.name}”超过单图容量上限，未导入`]);
        }

        return {
            success: true,
            pack,
            imported: 0,
            assignedIcons: 0,
            poolIcons: 0,
            discardedIcons: 0,
            unmatchedIcons: 0,
            warnings: [],
            errors: [],
            message: '外观包校验通过',
        };
    } catch (error) {
        const message = error?.message || '未知错误';
        return createAppearancePackFailure(`导入失败：${message}`, [message]);
    }
}

export function applyAppearanceResourcePack(packInput, options = {}) {
    const warnings = [];
    const validationResult = validateAppearanceResourcePack(packInput);
    if (!validationResult.success || !validationResult.pack) {
        return validationResult;
    }

    const pack = validationResult.pack;
    const currentSettings = getPhoneSettings();
    const iconSlots = collectAppearanceIconSlots();
    const packIcons = [
        ...pack.icons,
        ...dedupeResourcesByContent(pack.iconPool),
    ];
    const wallpaper = pack.wallpapers[0] || null;
    const assignment = buildReplacingIconAssignment({
        iconSlots,
        packIcons,
    });
    const nextTotalIconBytes = estimateIconsStorageBytes(assignment.nextIcons);

    if (nextTotalIconBytes > STORAGE_BUDGETS.appIconsTotalBytes) {
        return createAppearancePackFailure(
            '导入失败：图标总容量超限',
            ['导入后图标总容量超过上限，未导入'],
            warnings,
            {
                discardedIcons: assignment.discarded.length,
                unmatchedIcons: assignment.discarded.length,
            },
        );
    }

    if (iconSlots.length === 0 && packIcons.length > 0) {
        warnings.push('当前没有可分配图标位，图标已丢弃');
    } else if (assignment.discarded.length > 0) {
        warnings.push(`有 ${assignment.discarded.length} 个图标超过当前图标位数量，已丢弃`);
    }
    if (assignment.scoreMatchedIcons.length > 0) {
        warnings.push(`有 ${assignment.scoreMatchedIcons.length} 个图标通过名称相似度匹配`);
    }
    if (assignment.sequentialFilledIcons.length > 0) {
        warnings.push(`有 ${assignment.sequentialFilledIcons.length} 个图标未找到名称相似项，已按剩余图标位顺序补位`);
    }

    const backup = {
        backgroundImage: currentSettings.backgroundImage || null,
        appIcons: { ...(currentSettings.appIcons || {}) },
        appearanceResourcePool: currentSettings.appearanceResourcePool || createEmptyAppearanceResourcePool(),
        appearanceActivePackId: safeString(currentSettings.appearanceActivePackId, 160),
    };
    const patch = {
        backgroundImage: wallpaper ? wallpaper.dataUrl : backup.backgroundImage,
        appIcons: assignment.nextIcons,
        appearanceResourcePool: createEmptyAppearanceResourcePool(),
    };
    const activePackId = safeString(options.activePackId, 160);
    if (activePackId && options.markActivePack !== false) {
        patch.appearanceActivePackId = activePackId;
    }

    const saved = savePhoneSettingsPatch(patch);
    if (!saved) {
        savePhoneSettingsPatch(backup);
        flushPhoneSettingsSave();
        return createAppearancePackFailure(
            '导入失败：设置保存失败',
            ['设置保存失败，已回滚'],
            warnings,
            {
                discardedIcons: assignment.discarded.length,
                unmatchedIcons: assignment.discarded.length,
            },
        );
    }
    flushPhoneSettingsSave();

    return {
        success: true,
        imported: (wallpaper ? 1 : 0) + assignment.assigned.length,
        assignedIcons: assignment.assigned.length,
        poolIcons: 0,
        discardedIcons: assignment.discarded.length,
        unmatchedIcons: assignment.discarded.length,
        warnings,
        errors: [],
        message: `导入完成：背景 ${wallpaper ? 1 : 0}，分配图标 ${assignment.assigned.length}，丢弃多余图标 ${assignment.discarded.length}`,
    };
}

export function importAppearanceResourcePackFromData(input) {
    return applyAppearanceResourcePack(input, { markActivePack: false });
}
