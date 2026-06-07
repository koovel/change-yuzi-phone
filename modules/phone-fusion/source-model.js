import {
    BUILTIN_THEATER_TEMPLATE_SHA256,
    BUILTIN_THEATER_TEMPLATE_SOURCE_PATH,
    createBuiltinTheaterTemplate,
} from './builtin-theater-template.js';

export const FUSION_SOURCE_TYPES = Object.freeze({
    LOCAL: 'local',
    BUILTIN_THEATER: 'builtin-theater',
    DATABASE_CURRENT: 'database-current',
});

const KNOWN_FUSION_SOURCE_TYPES = new Set(Object.values(FUSION_SOURCE_TYPES));

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createJsonCloneResult(value) {
    try {
        if (value === undefined) return { ok: true, value: undefined };
        const serialized = JSON.stringify(value);
        if (serialized === undefined) return { ok: true, value: undefined };
        return { ok: true, value: JSON.parse(serialized) };
    } catch (error) {
        return { ok: false, value: undefined, error };
    }
}

function cloneJsonValue(value) {
    return createJsonCloneResult(value).value;
}

function getSheetKeys(rawData) {
    if (!isPlainObject(rawData)) return [];
    return Object.keys(rawData)
        .filter((key) => key.startsWith('sheet_'))
        .sort((left, right) => {
            const leftSheet = rawData[left];
            const rightSheet = rawData[right];
            const leftOrder = Number.isFinite(leftSheet?.orderNo) ? leftSheet.orderNo : Number.POSITIVE_INFINITY;
            const rightOrder = Number.isFinite(rightSheet?.orderNo) ? rightSheet.orderNo : Number.POSITIVE_INFINITY;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return left.localeCompare(right);
        });
}

function getSheetDisplayName(sheet, key) {
    if (typeof sheet?.name === 'string' && sheet.name.trim()) return sheet.name.trim();
    return key;
}

function validateSheet(sheet, key) {
    const result = {
        key,
        name: getSheetDisplayName(sheet, key),
        orderNo: Number.isFinite(sheet?.orderNo) ? sheet.orderNo : null,
        cols: Array.isArray(sheet?.cols) ? cloneJsonValue(sheet.cols) : [],
        header: Array.isArray(sheet?.content?.[0]) ? cloneJsonValue(sheet.content[0]) : [],
        sheet: isPlainObject(sheet) ? cloneJsonValue(sheet) : sheet,
        valid: true,
        invalidReason: '',
    };

    if (!isPlainObject(sheet)) {
        result.valid = false;
        result.invalidReason = 'sheet_not_object';
        return result;
    }
    if (typeof sheet.name !== 'string' || !sheet.name.trim()) {
        result.valid = false;
        result.invalidReason = 'sheet_missing_name';
        return result;
    }
    if (!isPlainObject(sheet.sourceData)) {
        result.valid = false;
        result.invalidReason = 'sheet_missing_source_data';
        return result;
    }

    if (!Array.isArray(sheet.content)) {
        result.valid = false;
        result.invalidReason = 'sheet_content_not_array';
        return result;
    }
    if (!sheet.content.every((row) => Array.isArray(row))) {
        result.valid = false;
        result.invalidReason = 'sheet_content_not_2d_array';
        return result;
    }
    if (!Array.isArray(sheet.content[0]) || sheet.content[0].length === 0) {
        result.valid = false;
        result.invalidReason = 'sheet_missing_header';
        return result;
    }

    return result;
}

function createSourceModel(rawData, options = {}) {
    const type = options.type ?? FUSION_SOURCE_TYPES.LOCAL;
    const name = options.name ?? options.fileName ?? type;
    const rawClone = createJsonCloneResult(rawData);
    const sheetKeys = getSheetKeys(rawData);
    const sheets = isPlainObject(rawData) && rawClone.ok
        ? sheetKeys.map((key) => validateSheet(rawData[key], key))
        : [];
    const validSheetCount = sheets.filter((sheet) => sheet.valid).length;
    const invalidSheetCount = sheets.length - validSheetCount;
    const hasValidSheets = validSheetCount > 0;
    const hasInvalidSheets = invalidSheetCount > 0;
    const allSheetsValid = sheets.length > 0 && invalidSheetCount === 0;
    let invalidReason = '';

    if (!KNOWN_FUSION_SOURCE_TYPES.has(type)) {
        invalidReason = 'source_unknown_type';
    } else if (!rawClone.ok) {
        invalidReason = 'source_not_json_serializable';
    } else if (!isPlainObject(rawData)) {
        invalidReason = 'source_not_object';
    } else if (!isPlainObject(rawData.mate) || rawData.mate.type !== 'chatSheets') {
        invalidReason = 'source_not_chat_sheets';
    } else if (sheetKeys.length === 0) {
        invalidReason = 'source_no_sheets';
    } else if (validSheetCount === 0) {
        invalidReason = 'source_no_valid_sheets';
    }

    const sourceUsable = invalidReason === '';

    return {
        type,
        id: options.id ?? `${type}:${options.fileName ?? options.scope ?? options.sourcePath ?? name}`,
        name,
        valid: sourceUsable,
        invalidReason,
        sourceUsable,
        hasValidSheets,
        hasInvalidSheets,
        allSheetsValid,
        templateImportable: sourceUsable && allSheetsValid,
        rawData: rawClone.value,
        mate: isPlainObject(rawData?.mate) ? cloneJsonValue(rawData.mate) : {},
        sheetCount: sheets.length,
        validSheetCount,
        invalidSheetCount,
        sheets,
        meta: {
            fileName: options.fileName ?? '',
            sourcePath: options.sourcePath ?? '',
            sha256: options.sha256 ?? '',
            scope: options.scope ?? '',
        },
    };
}

export function validateFusionTemplate(rawData, options = {}) {
    return createSourceModel(rawData, options);
}

export function normalizeFusionSource(input, options = {}) {
    if (options.type === FUSION_SOURCE_TYPES.BUILTIN_THEATER) return createBuiltinTheaterSourceModel();
    return createSourceModel(input, options);
}

export function createLocalJsonSourceModel(rawData, fileName = '') {
    return createSourceModel(rawData, {
        type: FUSION_SOURCE_TYPES.LOCAL,
        fileName,
        name: fileName || '本地 JSON',
    });
}

export function createBuiltinTheaterSourceModel() {
    return createSourceModel(createBuiltinTheaterTemplate(), {
        type: FUSION_SOURCE_TYPES.BUILTIN_THEATER,
        id: FUSION_SOURCE_TYPES.BUILTIN_THEATER,
        name: '内置小剧场模板',
        sourcePath: BUILTIN_THEATER_TEMPLATE_SOURCE_PATH,
        sha256: BUILTIN_THEATER_TEMPLATE_SHA256,
    });
}

export function createDatabaseCurrentSourceModel(rawData, options = {}) {
    return createSourceModel(rawData, {
        ...options,
        type: FUSION_SOURCE_TYPES.DATABASE_CURRENT,
        name: options.name ?? '当前数据库表格',
        scope: options.scope ?? 'current-database',
    });
}
