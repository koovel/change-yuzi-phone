const CHECK_IN_PATTERN = /CHECK\s*\(\s*([A-Za-z_][\w$]*|"[^"]+"|`[^`]+`|\[[^\]]+\])\s+IN\s*\(/gi;

function toSafeString(value) {
    return value === undefined || value === null ? '' : String(value);
}

function normalizeIdentifier(identifier) {
    const text = toSafeString(identifier).trim();
    if (!text) return '';

    if (text.startsWith('[') && text.endsWith(']')) {
        return text.slice(1, -1).trim();
    }

    if (text.length >= 2) {
        const quote = text[0];
        const endQuote = text[text.length - 1];
        if ((quote === '"' && endQuote === '"') || (quote === '`' && endQuote === '`')) {
            return text.slice(1, -1).replaceAll(`${quote}${quote}`, quote).trim();
        }
    }

    return text;
}

function normalizeLookupKey(value) {
    return normalizeIdentifier(value).replace(/[\s_-]+/g, '').toLowerCase();
}

function uniqueNonEmptyStrings(values = []) {
    const seen = new Set();
    const result = [];

    values.forEach((value) => {
        const text = toSafeString(value);
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
    });

    return result;
}

function findClosingParen(text, openParenIndex) {
    let depth = 0;
    let inString = false;

    for (let index = openParenIndex; index < text.length; index++) {
        const char = text[index];
        const nextChar = text[index + 1];

        if (inString) {
            if (char === "'" && nextChar === "'") {
                index += 1;
                continue;
            }
            if (char === "'") {
                inString = false;
            }
            continue;
        }

        if (char === "'") {
            inString = true;
            continue;
        }

        if (char === '(') {
            depth += 1;
            continue;
        }

        if (char === ')') {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function findSqlLineCommentIndex(line) {
    let inString = false;

    for (let index = 0; index < line.length - 1; index++) {
        const char = line[index];
        const nextChar = line[index + 1];

        if (inString) {
            if (char === "'" && nextChar === "'") {
                index += 1;
                continue;
            }
            if (char === "'") {
                inString = false;
            }
            continue;
        }

        if (char === "'") {
            inString = true;
            continue;
        }

        if (char === '-' && nextChar === '-') {
            return index;
        }
    }

    return -1;
}

function getLineInfoAt(text, offset) {
    const safeOffset = Math.max(0, Math.min(Number(offset) || 0, text.length));
    const lineStart = text.lastIndexOf('\n', safeOffset) + 1;
    const nextLineBreak = text.indexOf('\n', safeOffset);
    const lineEnd = nextLineBreak >= 0 ? nextLineBreak : text.length;
    const lineNumber = text.slice(0, lineStart).split(/\r?\n/).length;

    return {
        lineNumber,
        text: text.slice(lineStart, lineEnd).replace(/\r$/, ''),
    };
}

function extractLineComment(line) {
    const commentIndex = findSqlLineCommentIndex(line);
    if (commentIndex < 0) return '';
    return line.slice(commentIndex + 2).trim();
}

function parseSqlValueList(listText) {
    const values = [];
    const text = toSafeString(listText);
    let index = 0;

    while (index < text.length) {
        while (index < text.length && /[\s,]/.test(text[index])) {
            index += 1;
        }
        if (index >= text.length) break;

        if (text[index] === "'") {
            index += 1;
            let value = '';
            let closed = false;

            while (index < text.length) {
                const char = text[index];
                const nextChar = text[index + 1];

                if (char === "'" && nextChar === "'") {
                    value += "'";
                    index += 2;
                    continue;
                }

                if (char === "'") {
                    closed = true;
                    index += 1;
                    break;
                }

                value += char;
                index += 1;
            }

            if (!closed) {
                return [];
            }

            values.push(value);
            continue;
        }

        const valueStart = index;
        while (index < text.length && text[index] !== ',') {
            index += 1;
        }
        const bareValue = text.slice(valueStart, index).trim();
        if (bareValue) {
            values.push(bareValue);
        }
    }

    return uniqueNonEmptyStrings(values);
}

function parseDdlEnumConstraints(ddl) {
    const text = toSafeString(ddl);
    if (!text.trim()) return [];

    const constraints = [];
    CHECK_IN_PATTERN.lastIndex = 0;

    let match = CHECK_IN_PATTERN.exec(text);
    while (match) {
        const columnName = normalizeIdentifier(match[1]);
        const valuesOpenParenIndex = CHECK_IN_PATTERN.lastIndex - 1;
        const valuesCloseParenIndex = findClosingParen(text, valuesOpenParenIndex);

        if (columnName && valuesCloseParenIndex > valuesOpenParenIndex) {
            const valuesText = text.slice(valuesOpenParenIndex + 1, valuesCloseParenIndex);
            const options = parseSqlValueList(valuesText);
            if (options.length > 0) {
                const lineInfo = getLineInfoAt(text, match.index);
                constraints.push({
                    type: 'enum',
                    source: 'ddl-check-in',
                    columnName,
                    label: extractLineComment(lineInfo.text),
                    options,
                    lineNumber: lineInfo.lineNumber,
                    ddlLine: lineInfo.text.trim(),
                });
            }
            CHECK_IN_PATTERN.lastIndex = valuesCloseParenIndex + 1;
        }

        match = CHECK_IN_PATTERN.exec(text);
    }

    return constraints;
}

function resolveConstraintRawIndex(constraint, headers = [], rawHeaders = [], usedIndexes = new Set()) {
    const exactCandidates = uniqueNonEmptyStrings([
        constraint.label,
        constraint.columnName,
    ].map((value) => toSafeString(value).trim()));
    const normalizedCandidates = new Set(exactCandidates.map(normalizeLookupKey).filter(Boolean));
    const maxLength = Math.max(headers.length, rawHeaders.length);

    for (let index = 0; index < maxLength; index++) {
        if (usedIndexes.has(index)) continue;
        const header = toSafeString(headers[index]).trim();
        const rawHeader = toSafeString(rawHeaders[index]).trim();
        if (exactCandidates.includes(header) || exactCandidates.includes(rawHeader)) {
            return index;
        }
    }

    for (let index = 0; index < maxLength; index++) {
        if (usedIndexes.has(index)) continue;
        const headerKey = normalizeLookupKey(headers[index]);
        const rawHeaderKey = normalizeLookupKey(rawHeaders[index]);
        if ((headerKey && normalizedCandidates.has(headerKey)) || (rawHeaderKey && normalizedCandidates.has(rawHeaderKey))) {
            return index;
        }
    }

    return -1;
}

function createEnumFieldMetadata(constraint, rawColIndex, headers = [], rawHeaders = []) {
    const header = toSafeString(headers[rawColIndex]).trim();
    const rawHeader = toSafeString(rawHeaders[rawColIndex]).trim();
    const label = toSafeString(constraint.label || header || rawHeader || constraint.columnName).trim();

    return {
        type: 'enum',
        control: 'select',
        source: constraint.source,
        rawColIndex,
        header,
        rawHeader,
        columnName: constraint.columnName,
        label,
        options: [...constraint.options],
        lineNumber: constraint.lineNumber,
        ddlLine: constraint.ddlLine,
    };
}

export function createDdlFieldMetadata(options = {}) {
    const ddl = toSafeString(options.ddl);
    const headers = Array.isArray(options.headers) ? options.headers : [];
    const rawHeaders = Array.isArray(options.rawHeaders) ? options.rawHeaders : [];
    const enumConstraints = parseDdlEnumConstraints(ddl);
    const byRawIndex = {};
    const byHeader = {};
    const usedIndexes = new Set();

    enumConstraints.forEach((constraint) => {
        const rawColIndex = resolveConstraintRawIndex(constraint, headers, rawHeaders, usedIndexes);
        if (!Number.isInteger(rawColIndex) || rawColIndex < 0) return;

        const fieldMetadata = createEnumFieldMetadata(constraint, rawColIndex, headers, rawHeaders);
        byRawIndex[String(rawColIndex)] = fieldMetadata;
        usedIndexes.add(rawColIndex);

        uniqueNonEmptyStrings([
            fieldMetadata.header,
            fieldMetadata.rawHeader,
            fieldMetadata.label,
            fieldMetadata.columnName,
        ].map((value) => toSafeString(value).trim())).forEach((key) => {
            byHeader[key] = fieldMetadata;
        });
    });

    return {
        hasDdl: ddl.trim().length > 0,
        enumConstraints,
        byRawIndex,
        byHeader,
    };
}

export function getDdlFieldMetadataForIndex(ddlFieldMetadata, rawColIndex) {
    const idx = Number(rawColIndex);
    if (!ddlFieldMetadata || !Number.isInteger(idx) || idx < 0) return null;

    const fieldMetadata = ddlFieldMetadata.byRawIndex?.[String(idx)] || null;
    return fieldMetadata?.type === 'enum' && Array.isArray(fieldMetadata.options)
        ? fieldMetadata
        : null;
}

export function validateEnumFieldValue(fieldMetadata, value) {
    if (!fieldMetadata || fieldMetadata.type !== 'enum' || !Array.isArray(fieldMetadata.options)) {
        return null;
    }

    const rawValue = toSafeString(value);
    if (rawValue.trim() === '') return null;
    if (fieldMetadata.options.includes(rawValue)) return null;

    const fieldLabel = fieldMetadata.label || fieldMetadata.header || fieldMetadata.rawHeader || fieldMetadata.columnName || '该字段';
    return {
        field: fieldLabel,
        rawColIndex: fieldMetadata.rawColIndex,
        columnName: fieldMetadata.columnName,
        value: rawValue,
        allowedValues: [...fieldMetadata.options],
        message: `${fieldLabel} 只能选择：${fieldMetadata.options.join('、')}`,
    };
}

export function findFirstEnumValidationError(options = {}) {
    const ddlFieldMetadata = options.ddlFieldMetadata || options.metadata || null;
    const data = options.data && typeof options.data === 'object' ? options.data : {};
    const valuesByRawIndex = options.valuesByRawIndex && typeof options.valuesByRawIndex === 'object'
        ? options.valuesByRawIndex
        : null;
    const fieldIndexes = Array.isArray(options.fieldIndexes)
        ? options.fieldIndexes
        : Object.keys(ddlFieldMetadata?.byRawIndex || {}).map((key) => Number(key));

    for (const rawIndexValue of fieldIndexes) {
        const rawColIndex = Number(rawIndexValue);
        const fieldMetadata = getDdlFieldMetadataForIndex(ddlFieldMetadata, rawColIndex);
        if (!fieldMetadata) continue;

        const keyCandidates = uniqueNonEmptyStrings([
            fieldMetadata.header,
            fieldMetadata.rawHeader,
            fieldMetadata.label,
            fieldMetadata.columnName,
        ].map((value) => toSafeString(value).trim()));
        let valueFound = false;
        let value = '';
        let dataKey = '';

        for (const key of keyCandidates) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                value = data[key];
                dataKey = key;
                valueFound = true;
                break;
            }
        }

        if (!valueFound && valuesByRawIndex && Object.prototype.hasOwnProperty.call(valuesByRawIndex, rawColIndex)) {
            value = valuesByRawIndex[rawColIndex];
            dataKey = String(rawColIndex);
            valueFound = true;
        }

        if (!valueFound) continue;

        const validationError = validateEnumFieldValue(fieldMetadata, value);
        if (validationError) {
            return {
                ...validationError,
                dataKey,
            };
        }
    }

    return null;
}
