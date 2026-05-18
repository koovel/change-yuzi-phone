function normalizeHeaderText(value) {
    return String(value ?? '').trim();
}

function normalizeHeaderLookupKey(value) {
    return normalizeHeaderText(value)
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

const AUTO_MANAGED_ROW_ID_HEADER_KEYS = new Set([
    'rowid',
    '行号',
]);

export function isAutoManagedRowIdHeader(header) {
    const text = normalizeHeaderText(header);
    if (!text) return false;
    return AUTO_MANAGED_ROW_ID_HEADER_KEYS.has(normalizeHeaderLookupKey(text));
}

export function isAutoManagedRowIdColumn(headers = [], rawHeaders = [], colIndex = -1) {
    const index = Number(colIndex);
    if (!Number.isInteger(index) || index !== 0) return false;

    return isAutoManagedRowIdHeader(rawHeaders?.[index]) || isAutoManagedRowIdHeader(headers?.[index]);
}

export function shouldHideLeadingPlaceholderColumn(rawHeaders = [], row = []) {
    const firstRawHeader = normalizeHeaderText(rawHeaders?.[0]);
    const firstRawValue = Array.isArray(row) ? normalizeHeaderText(row[0]) : '';
    return firstRawHeader === '' && firstRawValue === '';
}

export function shouldSkipAutoManagedColumn(options = {}) {
    const {
        headers = [],
        rawHeaders = [],
        colIndex = -1,
        row = [],
        hideLeadingPlaceholder = false,
    } = options;
    const index = Number(colIndex);
    if (!Number.isInteger(index) || index < 0) return false;

    if (hideLeadingPlaceholder && index === 0) {
        const rawHeader = normalizeHeaderText(rawHeaders?.[index]);
        const rawValue = Array.isArray(row) ? normalizeHeaderText(row[index]) : '';
        if (rawHeader === '' && rawValue === '') return true;
    }

    return isAutoManagedRowIdColumn(headers, rawHeaders, index);
}

export function hasLeadingHiddenSystemColumn(headers = [], rawHeaders = [], row = []) {
    return shouldHideLeadingPlaceholderColumn(rawHeaders, row)
        || isAutoManagedRowIdColumn(headers, rawHeaders, 0);
}

export function toVisibleDataColumnIndex(rawColIndex, headers = [], rawHeaders = [], row = []) {
    const index = Number(rawColIndex);
    if (!Number.isInteger(index) || index < 0) return -1;
    return hasLeadingHiddenSystemColumn(headers, rawHeaders, row) ? index - 1 : index;
}

export function findHeaderIndexByAliases(headers = [], aliases = [], options = {}) {
    const headerList = Array.isArray(headers) ? headers : [];
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    const normalizedAliases = new Set(aliasList.map(normalizeHeaderLookupKey).filter(Boolean));
    const requireAutoManagedRowIdColumn = options.requireAutoManagedRowIdColumn === true;

    for (let index = 0; index < headerList.length; index += 1) {
        const header = headerList[index];
        const key = normalizeHeaderLookupKey(header);
        if (!key || !normalizedAliases.has(key)) continue;
        if (requireAutoManagedRowIdColumn && !isAutoManagedRowIdColumn(headerList, headerList, index)) continue;
        return index;
    }

    return -1;
}

export function findAutoManagedRowIdColumnIndex(headers = [], rawHeaders = []) {
    const headerList = Array.isArray(headers) ? headers : [];
    const rawHeaderList = Array.isArray(rawHeaders) ? rawHeaders : headerList;
    return isAutoManagedRowIdColumn(headerList, rawHeaderList, 0) ? 0 : -1;
}

export const AUTO_MANAGED_ROW_ID_HEADER_ALIASES = Object.freeze(['row_id', 'row id', 'row-id', 'rowid', '行号']);
