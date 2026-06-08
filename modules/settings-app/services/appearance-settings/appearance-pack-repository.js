import { estimateBase64Bytes } from '../media-upload.js';
import { validateAppearanceResourcePack } from './resource-pack-service.js';

export const DB_NAME = 'yuzi-phone-appearance-packs';
export const DB_VERSION = 1;
export const STORE_PACKS = 'appearancePacks';
export const MAX_PACK_COUNT = 20;
export const MAX_SINGLE_PACK_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_PACK_BYTES = 100 * 1024 * 1024;

let dbPromise = null;
let saveQueue = Promise.resolve();

function safeString(value, maxLength = 256) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function createResult(success, message, extra = {}) {
    return {
        success,
        message,
        ...extra,
    };
}

function classifyIdbError(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || error || '');
    if (name.includes('quota')) return 'quota';
    if (name.includes('security') || name.includes('notallowed') || name.includes('blocked')) return 'access';
    if (name.includes('notfound') || name.includes('invalidstate')) return 'access';
    if (/quota/i.test(message)) return 'quota';
    return 'unknown';
}

function clearCachedDbPromise(promise) {
    if (dbPromise === promise) {
        dbPromise = null;
    }
}

function initializeStores(db) {
    if (!db.objectStoreNames.contains(STORE_PACKS)) {
        db.createObjectStore(STORE_PACKS, { keyPath: 'id' });
    }
}

function openDb() {
    if (dbPromise) return dbPromise;

    let nextPromise;
    nextPromise = new Promise((resolve, reject) => {
        let request;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
            reject(error);
            return;
        }

        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new DOMException('外观包仓库数据库升级被阻塞', 'BlockedError'));
        request.onupgradeneeded = () => initializeStores(request.result);
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => {
                db.close();
                clearCachedDbPromise(nextPromise);
            };
            resolve(db);
        };
    });

    nextPromise.catch(() => clearCachedDbPromise(nextPromise));
    dbPromise = nextPromise;
    return dbPromise;
}


function isIdbRequestLike(value) {
    return Boolean(value)
        && typeof value === 'object'
        && 'onsuccess' in value
        && 'onerror' in value
        && 'result' in value;
}

function withPackStore(mode, handler) {
    return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PACKS, mode);
        const store = tx.objectStore(STORE_PACKS);
        let result;
        let settled = false;

        const rejectOnce = (error) => {
            if (settled) return;
            settled = true;
            reject(error || tx.error || new Error('外观包仓库事务失败'));
        };

        try {
            const operation = handler(store);
            if (isIdbRequestLike(operation)) {
                operation.addEventListener('success', () => {
                    result = operation.result;
                }, { once: true });
                operation.addEventListener('error', () => rejectOnce(operation.error || tx.error), { once: true });
            } else {
                result = operation;
            }
        } catch (error) {
            rejectOnce(error);
            return;
        }

        tx.oncomplete = () => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        tx.onerror = () => rejectOnce(tx.error);
        tx.onabort = () => rejectOnce(tx.error);
    }));
}

function enqueueRepositoryWrite(operation) {
    const nextOperation = saveQueue.then(operation, operation);
    saveQueue = nextOperation.catch(() => {});
    return nextOperation;
}

function readAllPacks() {
    return withPackStore('readonly', store => store.getAll());
}

function estimateResourceBytes(resource) {
    const declared = Number(resource?.bytes);
    if (Number.isFinite(declared) && declared > 0) {
        return Math.round(declared);
    }
    return estimateBase64Bytes(resource?.dataUrl || '');
}

function estimatePackBytes(pack) {
    const resources = [
        ...(Array.isArray(pack?.wallpapers) ? pack.wallpapers : []),
        ...(Array.isArray(pack?.icons) ? pack.icons : []),
        ...(Array.isArray(pack?.iconPool) ? pack.iconPool : []),
    ];
    return resources.reduce((sum, resource) => sum + estimateResourceBytes(resource), 0);
}

function createPackId() {
    const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `appearance_pack_${randomPart}`.slice(0, 160);
}

function getPackName(pack, fallback = '未命名美化包') {
    return safeString(pack?.packMeta?.name || pack?.name || fallback, 120) || fallback;
}

function createEntryMeta(entry) {
    return {
        id: entry.id,
        name: entry.name,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        sourceFileName: entry.sourceFileName,
        format: entry.format,
        schemaVersion: entry.schemaVersion,
        wallpaperCount: entry.wallpaperCount,
        iconCount: entry.iconCount,
        totalBytes: entry.totalBytes,
        previewWallpaperDataUrl: entry.previewWallpaperDataUrl || '',
    };
}

function createEntryFromPack(pack, options = {}, existing = null) {
    const now = Date.now();
    const id = safeString(options.id || existing?.id || createPackId(), 160) || createPackId();
    const totalBytes = estimatePackBytes(pack);
    return {
        id,
        name: getPackName(pack, options.name || existing?.name),
        createdAt: Number.isFinite(Number(existing?.createdAt)) ? Number(existing.createdAt) : now,
        updatedAt: now,
        sourceFileName: safeString(options.sourceFileName || existing?.sourceFileName || '', 180),
        format: safeString(pack.format, 80),
        schemaVersion: Number(pack.schemaVersion || 0),
        wallpaperCount: Array.isArray(pack.wallpapers) ? pack.wallpapers.length : 0,
        iconCount: (Array.isArray(pack.icons) ? pack.icons.length : 0) + (Array.isArray(pack.iconPool) ? pack.iconPool.length : 0),
        totalBytes,
        previewWallpaperDataUrl: '',
        pack,
    };
}

function createStatsFromEntries(entries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    return {
        count: safeEntries.length,
        totalBytes: safeEntries.reduce((sum, entry) => sum + Math.max(0, Number(entry?.totalBytes) || 0), 0),
        maxPackCount: MAX_PACK_COUNT,
        maxSinglePackBytes: MAX_SINGLE_PACK_BYTES,
        maxTotalPackBytes: MAX_TOTAL_PACK_BYTES,
    };
}

function createRepositoryErrorResult(message, error, extra = {}) {
    return createResult(false, message, {
        errorType: classifyIdbError(error),
        errorMessage: error?.message || String(error || ''),
        ...extra,
    });
}

export async function listAppearancePacks() {
    try {
        const entries = await readAllPacks();
        const packs = entries
            .map(createEntryMeta)
            .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
        return createResult(true, '外观包仓库列表已读取', {
            packs,
            stats: createStatsFromEntries(entries),
        });
    } catch (error) {
        return createRepositoryErrorResult('读取外观包仓库失败', error, { packs: [], stats: createStatsFromEntries([]) });
    }
}

export async function getAppearancePack(id) {
    const safeId = safeString(id, 160);
    if (!safeId) {
        return createResult(false, '读取失败：外观包 ID 为空', { pack: null, meta: null });
    }

    try {
        const entry = await withPackStore('readonly', store => store.get(safeId));
        if (!entry) {
            return createResult(false, '读取失败：外观包不存在', { pack: null, meta: null });
        }
        return createResult(true, '外观包已读取', {
            pack: entry.pack,
            meta: createEntryMeta(entry),
        });
    } catch (error) {
        return createRepositoryErrorResult('读取外观包失败', error, { pack: null, meta: null });
    }
}

export async function saveAppearancePack(packInput, options = {}) {
    const validationResult = validateAppearanceResourcePack(packInput);
    if (!validationResult.success || !validationResult.pack) {
        return createResult(false, validationResult.message || '保存失败：外观包无效', {
            errors: validationResult.errors || [],
            warnings: validationResult.warnings || [],
            meta: null,
        });
    }

    return enqueueRepositoryWrite(async () => {
        try {
            const entries = await readAllPacks();
            const requestedId = safeString(options.id, 160);
            const existing = requestedId ? entries.find(entry => entry.id === requestedId) || null : null;
            const entry = createEntryFromPack(validationResult.pack, options, existing);
            const replacedBytes = existing ? Math.max(0, Number(existing.totalBytes) || 0) : 0;
            const stats = createStatsFromEntries(entries);

            if (!existing && stats.count >= MAX_PACK_COUNT) {
                return createResult(false, `保存失败：仓库最多保存 ${MAX_PACK_COUNT} 个美化包`, {
                    errorType: 'capacity',
                    meta: null,
                    stats,
                });
            }
            if (entry.totalBytes > MAX_SINGLE_PACK_BYTES) {
                return createResult(false, `保存失败：单个美化包不能超过 ${Math.round(MAX_SINGLE_PACK_BYTES / 1024 / 1024)}MB`, {
                    errorType: 'capacity',
                    meta: null,
                    stats,
                });
            }
            if (stats.totalBytes - replacedBytes + entry.totalBytes > MAX_TOTAL_PACK_BYTES) {
                return createResult(false, `保存失败：美化包仓库总容量不能超过 ${Math.round(MAX_TOTAL_PACK_BYTES / 1024 / 1024)}MB`, {
                    errorType: 'capacity',
                    meta: null,
                    stats,
                });
            }

            await withPackStore('readwrite', store => store.put(entry));
            const nextEntries = await readAllPacks();
            return createResult(true, '美化包已保存到仓库，当前外观未自动应用', {
                meta: createEntryMeta(entry),
                stats: createStatsFromEntries(nextEntries),
            });
        } catch (error) {
            return createRepositoryErrorResult('保存外观包失败', error, { meta: null });
        }
    });
}

export async function deleteAppearancePack(id) {
    const safeId = safeString(id, 160);
    if (!safeId) {
        return createResult(false, '删除失败：外观包 ID 为空', { deletedId: '' });
    }

    try {
        const existing = await withPackStore('readonly', store => store.get(safeId));
        if (!existing) {
            return createResult(false, '删除失败：外观包不存在', { deletedId: safeId });
        }
        await withPackStore('readwrite', store => store.delete(safeId));
        const entries = await readAllPacks();
        return createResult(true, '美化包已从仓库删除', {
            deletedId: safeId,
            stats: createStatsFromEntries(entries),
        });
    } catch (error) {
        return createRepositoryErrorResult('删除外观包失败', error, { deletedId: safeId });
    }
}

export async function getAppearancePackRepositoryStats() {
    try {
        const entries = await readAllPacks();
        return createResult(true, '外观包仓库容量统计已读取', {
            stats: createStatsFromEntries(entries),
        });
    } catch (error) {
        return createRepositoryErrorResult('读取外观包仓库容量统计失败', error, { stats: createStatsFromEntries([]) });
    }
}
