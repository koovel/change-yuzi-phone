const FALLBACK_ANCHOR = Object.freeze({ year: 2026, monthIndex: 0, day: 1 });
const ABSTRACT_YEAR_BUCKETS = 7;
const ABSTRACT_MONTHS_PER_YEAR = 12;
const ABSTRACT_DAYS_PER_MONTH = 30;
const ABSTRACT_DAYS_PER_YEAR = ABSTRACT_MONTHS_PER_YEAR * ABSTRACT_DAYS_PER_MONTH;
const REAL_MONTHS_PER_YEAR = 12;
const DATE_NUMBER_TOKEN_PATTERN = '[+-]?[0-9零〇一二两三四五六七八九十百千万]+';

function normalizeDateText(value) {
    return String(value ?? '').trim();
}

function hashStringToIndex(text, modulo) {
    if (!Number.isFinite(modulo) || modulo <= 0) return 0;
    const value = String(text || '');
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % modulo;
}

export function pad2(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.trunc(Math.abs(number))).padStart(2, '0') : '00';
}

export function clampDay(day, maxDay) {
    const safeDay = Number(day);
    if (!Number.isFinite(safeDay)) return 1;
    return Math.min(Math.max(1, Math.trunc(safeDay)), Math.max(1, Math.trunc(maxDay) || ABSTRACT_DAYS_PER_MONTH));
}

export function getRealMonthDays(year, monthIndex) {
    const safeYear = Number(year);
    const safeMonthIndex = Number(monthIndex);
    if (!Number.isInteger(safeYear) || !Number.isInteger(safeMonthIndex) || safeMonthIndex < 0 || safeMonthIndex > 11) {
        return 0;
    }
    return new Date(safeYear, safeMonthIndex + 1, 0).getDate();
}

export function normalizeAbstractMonthDays(monthDaysValue = '') {
    const number = Number(monthDaysValue);
    return Number.isInteger(number) && number >= 28 && number <= 31 ? number : ABSTRACT_DAYS_PER_MONTH;
}

export function formatDateKey(year, monthIndex, day) {
    return `${year}-${pad2(Number(monthIndex) + 1)}-${pad2(day)}`;
}

export function formatDateLabel(year, monthIndex, day) {
    return formatDateKey(year, monthIndex, day);
}

function isChineseNumericText(text) {
    return /^[零〇一二两三四五六七八九十百千万]+$/.test(normalizeDateText(text));
}

function parseChineseDigit(char) {
    const digits = {
        零: 0,
        〇: 0,
        一: 1,
        二: 2,
        两: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
    };
    return Object.prototype.hasOwnProperty.call(digits, char) ? digits[char] : null;
}

function parseChinesePositionalNumber(text) {
    const value = normalizeDateText(text);
    if (!value || !isChineseNumericText(value)) return null;

    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let total = 0;
    let section = 0;
    let currentNumber = 0;
    let hasUnit = false;

    for (const char of value) {
        const digit = parseChineseDigit(char);
        if (digit !== null) {
            currentNumber = digit;
            continue;
        }

        const unit = units[char];
        if (!unit) return null;
        hasUnit = true;
        if (unit === 10000) {
            section = (section + (currentNumber || 0)) || 1;
            total += section * unit;
            section = 0;
        } else {
            section += (currentNumber || 1) * unit;
        }
        currentNumber = 0;
    }

    const positionalValue = total + section + currentNumber;
    if (hasUnit) return positionalValue;

    const digitText = [...value].map(parseChineseDigit);
    if (digitText.some(digit => digit === null)) return null;
    return Number(digitText.join(''));
}

function parseDateNumberToken(token, options = {}) {
    const text = normalizeDateText(token);
    if (!text) return null;

    const sign = text.startsWith('-') ? -1 : 1;
    const unsigned = text.replace(/^[+-]/, '');
    if (/^\d+$/.test(unsigned)) {
        const number = Number(unsigned);
        return Number.isSafeInteger(number) ? sign * number : null;
    }

    if (!options.allowSignedChinese && sign < 0) return null;
    const parsed = parseChinesePositionalNumber(unsigned);
    return Number.isSafeInteger(parsed) ? sign * parsed : null;
}

function floorDivBigInt(value, divisor) {
    const quotient = value / divisor;
    const remainder = value % divisor;
    return remainder < 0n ? quotient - 1n : quotient;
}

function normalizeLooseRealDateParts(year, month, day) {
    if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) return null;
    if (month === 0 || day === 0) return null;

    const monthOffset = BigInt(month - 1);
    const normalizedYearOffset = floorDivBigInt(monthOffset, BigInt(REAL_MONTHS_PER_YEAR));
    const normalizedMonthIndexBig = monthOffset - normalizedYearOffset * BigInt(REAL_MONTHS_PER_YEAR);
    const normalizedYearBig = BigInt(year) + normalizedYearOffset;
    const normalizedMonth = Number(normalizedMonthIndexBig) + 1;
    const normalizedDaySerial = computeRealDateSerialBigInt(normalizedYearBig, normalizedMonth, 1) + BigInt(day - 1);
    const normalizedParts = resolveRealDatePartsFromSerial(normalizedDaySerial);
    if (!normalizedParts) return null;

    return {
        inputYear: year,
        inputMonth: month,
        inputDay: day,
        normalizedYear: normalizedParts.year,
        normalizedMonth: normalizedParts.month,
        normalizedDay: normalizedParts.day,
        normalizedMonthIndex: normalizedParts.month - 1,
        daySerial: normalizedDaySerial,
    };
}

function parseRealDateText(text) {
    const value = normalizeDateText(text);
    const numberPattern = DATE_NUMBER_TOKEN_PATTERN;
    const match = value.match(new RegExp(`^(${numberPattern})-(${numberPattern})-(${numberPattern})$`));
    if (!match) return null;

    const year = parseDateNumberToken(match[1], { allowSignedChinese: false });
    const month = parseDateNumberToken(match[2]);
    const day = parseDateNumberToken(match[3]);
    const normalized = normalizeLooseRealDateParts(year, month, day);
    if (!normalized) return null;

    return {
        kind: 'real',
        raw: value,
        year: normalized.normalizedYear,
        monthIndex: normalized.normalizedMonthIndex,
        day: normalized.normalizedDay,
        inputYear: normalized.inputYear,
        inputMonth: normalized.inputMonth,
        inputDay: normalized.inputDay,
        key: formatDateKey(normalized.normalizedYear, normalized.normalizedMonthIndex, normalized.normalizedDay),
        label: formatDateLabel(normalized.normalizedYear, normalized.normalizedMonthIndex, normalized.normalizedDay),
        monthDays: getRealMonthDays(normalized.normalizedYear, normalized.normalizedMonthIndex),
        daySerial: normalized.daySerial,
    };
}

function parseAbstractDateText(text, monthDaysValue = '') {
    const value = normalizeDateText(text);
    const match = value.match(new RegExp(`^(.+?)-(.+?)-(${DATE_NUMBER_TOKEN_PATTERN})$`));
    if (!match) return null;

    const yearLabel = normalizeDateText(match[1]);
    const monthLabel = normalizeDateText(match[2]);
    const numericDay = parseDateNumberToken(match[3]);
    if (!yearLabel || !monthLabel || !Number.isSafeInteger(numericDay) || numericDay === 0) return null;

    const monthDays = normalizeAbstractMonthDays(monthDaysValue);
    const day = numericDay;
    const anchorYearOffset = resolveAbstractYearIndex(yearLabel);
    const monthIndex = hashStringToIndex(monthLabel, ABSTRACT_MONTHS_PER_YEAR);
    const year = FALLBACK_ANCHOR.year + Number(anchorYearOffset % BigInt(ABSTRACT_YEAR_BUCKETS));
    const daySerial = anchorYearOffset * BigInt(ABSTRACT_DAYS_PER_YEAR)
        + BigInt(monthIndex * ABSTRACT_DAYS_PER_MONTH)
        + BigInt(day - 1);

    return {
        kind: 'abstract',
        raw: value,
        year,
        monthIndex,
        day,
        key: formatDateKey(year, monthIndex, day),
        label: value,
        monthDays,
        abstractPrefix: `${yearLabel}-${monthLabel}`,
        abstractYearLabel: yearLabel,
        abstractMonthLabel: monthLabel,
        daySerial,
    };
}

export function parseDateText(dateText, monthDaysValue = '') {
    const text = normalizeDateText(dateText);
    if (!text) return null;
    return parseRealDateText(text) || parseAbstractDateText(text, monthDaysValue);
}

export function getDateWithOffset(anchor, offset) {
    const safeOffset = Number(offset);
    if (!Number.isInteger(safeOffset)) return null;

    if (anchor?.kind === 'abstract') {
        const monthDays = normalizeAbstractMonthDays(anchor.monthDays);
        const total = (Number(anchor.monthIndex) * monthDays) + Number(anchor.day) - 1 + safeOffset;
        const cycleDays = monthDays * ABSTRACT_MONTHS_PER_YEAR;
        const yearOffset = Math.floor(total / cycleDays);
        const normalizedYearDay = ((total % cycleDays) + cycleDays) % cycleDays;
        const monthIndex = Math.floor(normalizedYearDay / monthDays);
        const day = (normalizedYearDay % monthDays) + 1;
        const displayYear = Number.isFinite(Number(anchor.year)) ? Number(anchor.year) + yearOffset : FALLBACK_ANCHOR.year + yearOffset;
        const daySerial = typeof anchor.daySerial === 'bigint'
            ? anchor.daySerial + BigInt(safeOffset)
            : null;
        return {
            year: displayYear,
            monthIndex,
            day,
            key: formatDateKey(displayYear, monthIndex, day),
            label: formatDateLabel(displayYear, monthIndex, day),
            kind: 'abstract-derived',
            daySerial,
        };
    }

    const anchorDaySerial = typeof anchor?.daySerial === 'bigint'
        ? anchor.daySerial
        : computeRealDateSerial(anchor?.year, Number(anchor?.monthIndex) + 1, anchor?.day);
    if (typeof anchorDaySerial !== 'bigint') return null;

    const daySerial = anchorDaySerial + BigInt(safeOffset);
    const resolved = resolveRealDatePartsFromSerial(daySerial, typeof anchor?.year === 'number' ? BigInt(anchor.year) : null);
    if (!resolved) return null;

    return {
        year: resolved.year,
        monthIndex: resolved.month - 1,
        day: resolved.day,
        key: formatDateKey(resolved.year, resolved.month - 1, resolved.day),
        label: formatDateLabel(resolved.year, resolved.month - 1, resolved.day),
        kind: 'real-derived',
        daySerial,
    };
}

function extractLeadingDateFromText(text) {
    const value = normalizeDateText(text);
    if (!value) return '';

    const numberPattern = DATE_NUMBER_TOKEN_PATTERN;
    const realMatch = value.match(new RegExp(`^${numberPattern}-${numberPattern}-${numberPattern}(?=\\s|$|~)`));
    if (realMatch) return realMatch[0];

    const abstractMatch = value.match(new RegExp(`^(.+?-.+?-${numberPattern})(?=\\s|$|~)`));
    return abstractMatch ? abstractMatch[1].trim() : '';
}

export function parseLeadingDateFromText(text, monthDaysValue = '') {
    const firstDate = extractLeadingDateFromText(text);
    return firstDate ? parseDateText(firstDate, monthDaysValue) : null;
}

export function extractFirstDateFromTimeSpan(timeSpan) {
    return extractLeadingDateFromText(timeSpan);
}

export function parseFirstDateFromTimeSpan(timeSpan, monthDaysValue = '') {
    const firstDate = extractFirstDateFromTimeSpan(timeSpan);
    return firstDate ? parseDateText(firstDate, monthDaysValue) : null;
}

function extractTimeSpanRelationDateCandidates(timeSpan) {
    const text = normalizeDateText(timeSpan);
    if (!text) {
        return {
            firstDate: '',
            endDate: '',
            hasRangeSeparator: false,
        };
    }

    const separatorIndex = text.indexOf('~');
    const hasRangeSeparator = separatorIndex >= 0;
    const firstSegment = hasRangeSeparator ? text.slice(0, separatorIndex) : text;

    return {
        firstDate: extractLeadingDateFromText(firstSegment),
        endDate: hasRangeSeparator ? extractLeadingDateFromText(text.slice(separatorIndex + 1)) : '',
        hasRangeSeparator,
    };
}

function parseRelationDateCandidate(dateText, monthDaysValue = '') {
    const text = normalizeDateText(dateText);
    return text ? parseDateText(text, monthDaysValue) : null;
}

export function extractRelationDateFromTimeSpan(timeSpan) {
    const { firstDate, endDate, hasRangeSeparator } = extractTimeSpanRelationDateCandidates(timeSpan);
    return hasRangeSeparator ? endDate || firstDate : firstDate;
}

export function parseRelationDateFromTimeSpan(timeSpan, monthDaysValue = '') {
    const { firstDate, endDate, hasRangeSeparator } = extractTimeSpanRelationDateCandidates(timeSpan);
    const endParsed = hasRangeSeparator ? parseRelationDateCandidate(endDate, monthDaysValue) : null;
    if (endParsed) return endParsed;

    return parseRelationDateCandidate(firstDate, monthDaysValue);
}

function resolveAbstractYearIndex(yearLabel) {
    const numeric = normalizeDateText(yearLabel).match(/^[+-]?\d+$/);
    if (numeric) {
        return BigInt(numeric[0]);
    }
    return BigInt(hashStringToIndex(yearLabel, ABSTRACT_YEAR_BUCKETS));
}

function floorDiv(value, divisor) {
    return floorDivBigInt(value, divisor);
}

function isLeapYearBigInt(year) {
    return (year % 4n === 0n && year % 100n !== 0n) || year % 400n === 0n;
}

function daysBeforeYear(year) {
    const y = year - 1n;
    return y * 365n + floorDiv(y, 4n) - floorDiv(y, 100n) + floorDiv(y, 400n);
}

function getRealMonthDayCountsBigInt(year) {
    return [31n, isLeapYearBigInt(year) ? 29n : 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
}

function computeRealDateSerialBigInt(year, month, day) {
    const safeMonth = Number(month);
    const safeDay = Number(day);
    if (!Number.isInteger(safeMonth) || safeMonth < 1 || safeMonth > 12 || !Number.isSafeInteger(safeDay)) return null;

    const yearBigInt = typeof year === 'bigint' ? year : BigInt(year);
    const monthDays = getRealMonthDayCountsBigInt(yearBigInt);
    let days = daysBeforeYear(yearBigInt);
    for (let index = 0; index < safeMonth - 1; index += 1) {
        days += monthDays[index];
    }
    return days + BigInt(safeDay - 1);
}

function resolveRealDateSearchRange(daySerial, yearHint) {
    let lower = typeof yearHint === 'bigint' ? yearHint : floorDivBigInt(daySerial, 366n) + 1n;
    let upper = lower;
    let step = 1n;

    while (daysBeforeYear(lower) > daySerial) {
        upper = lower;
        lower -= step;
        step *= 2n;
    }

    step = 1n;
    while (daysBeforeYear(upper + 1n) <= daySerial) {
        lower = upper + 1n;
        upper += step;
        step *= 2n;
    }

    return { lower, upper };
}

function resolveRealDatePartsFromSerial(daySerial, yearHint = null) {
    if (typeof daySerial !== 'bigint') return null;

    const { lower, upper } = resolveRealDateSearchRange(daySerial, yearHint);
    let low = lower;
    let high = upper;
    while (low < high) {
        const middle = floorDivBigInt(low + high + 1n, 2n);
        if (daysBeforeYear(middle) <= daySerial) {
            low = middle;
        } else {
            high = middle - 1n;
        }
    }

    const yearBigInt = low;
    if (yearBigInt < BigInt(Number.MIN_SAFE_INTEGER) || yearBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return null;

    let dayOfYear = daySerial - daysBeforeYear(yearBigInt);
    const monthDays = getRealMonthDayCountsBigInt(yearBigInt);
    let monthIndex = 0;
    while (monthIndex < monthDays.length && dayOfYear >= monthDays[monthIndex]) {
        dayOfYear -= monthDays[monthIndex];
        monthIndex += 1;
    }
    if (monthIndex < 0 || monthIndex > 11) return null;

    return {
        year: Number(yearBigInt),
        month: monthIndex + 1,
        day: Number(dayOfYear + 1n),
    };
}

function computeRealDateSerial(year, month, day) {
    return computeRealDateSerialBigInt(year, month, day);
}

function getComparableDateKind(parsedDate) {
    if (parsedDate?.kind === 'real') return 'real';
    if (parsedDate?.kind === 'abstract' || parsedDate?.kind === 'abstract-derived') return 'abstract';
    return '';
}

export function calculateDateDiffDays(todayDate, targetDate) {
    if (!todayDate || !targetDate) return null;
    if (getComparableDateKind(todayDate) !== getComparableDateKind(targetDate)) return null;
    if (typeof todayDate.daySerial !== 'bigint' || typeof targetDate.daySerial !== 'bigint') return null;
    return todayDate.daySerial - targetDate.daySerial;
}

function formatIntegerWithUnit(value, unit, direction) {
    return `${value}${unit}${direction}`;
}

function toChineseSmallInteger(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) return String(value);
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (number < 10) return digits[number];
    if (number === 10) return '十';
    if (number < 20) return `十${digits[number % 10]}`;
    if (number < 100) {
        const tens = Math.floor(number / 10);
        const ones = number % 10;
        return `${digits[tens]}十${ones > 0 ? digits[ones] : ''}`;
    }
    return String(number);
}

function formatWholeUnitCount(count, unit) {
    if (unit === '个月') {
        if (count === 1) return '一个月';
        if (count === 2) return '两个月';
        return `${toChineseSmallInteger(count)}个月`;
    }
    if (unit === '年') {
        return `${count === 2 ? '两' : toChineseSmallInteger(count)}年`;
    }
    return `${toChineseSmallInteger(count)}${unit}`;
}

function formatHalfStep(count, unit, direction) {
    if (count === 0) return `半${unit}${direction}`;
    if (unit === '个月') {
        if (count === 1) return `一个半月${direction}`;
        if (count === 2) return `两个半月${direction}`;
        return `${toChineseSmallInteger(count)}个半月${direction}`;
    }
    if (unit === '年') {
        return `${formatWholeUnitCount(count, unit)}半${direction}`;
    }
    return `${formatWholeUnitCount(count, unit)}半${direction}`;
}

function normalizeHalfUnitCount(totalDays, halfUnitDays) {
    const halfSteps = totalDays / halfUnitDays;
    const wholeUnits = Math.floor(halfSteps / 2);
    const hasHalf = halfSteps % 2 === 1;
    return { wholeUnits, hasHalf };
}

export function formatRelativeDays(diffDays) {
    if (diffDays === null || diffDays === undefined) return '';
    const numericDiff = typeof diffDays === 'bigint' ? diffDays : BigInt(diffDays);
    if (numericDiff === 0n) return '今天';

    const direction = numericDiff > 0n ? '前' : '后';
    const absDaysBig = numericDiff > 0n ? numericDiff : -numericDiff;
    if (absDaysBig > BigInt(Number.MAX_SAFE_INTEGER)) {
        return formatLargeRelativeDays(absDaysBig, direction);
    }
    return formatRelativeDayNumber(Number(absDaysBig), direction);
}

function formatLargeRelativeDays(absDaysBig, direction) {
    const halfYearDays = 180n;
    const bucketStart = ((absDaysBig - 360n) / halfYearDays) * halfYearDays + 360n;
    const halfSteps = bucketStart / halfYearDays;
    const wholeYears = halfSteps / 2n;
    const hasHalf = halfSteps % 2n === 1n;
    const yearLabel = wholeYears <= 99n ? toChineseSmallInteger(Number(wholeYears)) : wholeYears.toString();
    if (hasHalf) return `${yearLabel}年半${direction}`;
    return `${yearLabel}年${direction}`;
}

function formatRelativeDayNumber(absDays, direction) {
    if (absDays === 1) return direction === '前' ? '昨天' : '明天';
    if (absDays === 2) return direction === '前' ? '前天' : '后天';
    if (absDays >= 3 && absDays <= 6) return formatIntegerWithUnit(absDays, '天', direction);
    if (absDays === 7) return `一周${direction}`;
    if (absDays >= 8 && absDays <= 14) return formatIntegerWithUnit(absDays, '天', direction);
    if (absDays === 15) return `半个月${direction}`;
    if (absDays >= 16 && absDays <= 20) return formatIntegerWithUnit(absDays, '天', direction);
    if (absDays === 21) return `三周${direction}`;
    if (absDays >= 22 && absDays <= 29) return formatIntegerWithUnit(absDays, '天', direction);
    if (absDays >= 30 && absDays <= 179) {
        const bucketStart = Math.floor((absDays - 30) / 15) * 15 + 30;
        const { wholeUnits, hasHalf } = normalizeHalfUnitCount(bucketStart, 15);
        return hasHalf ? formatHalfStep(wholeUnits, '个月', direction) : `${formatWholeUnitCount(wholeUnits, '个月')}${direction}`;
    }
    if (absDays >= 180 && absDays <= 359) return `半年${direction}`;

    const bucketStart = Math.floor((absDays - 360) / 180) * 180 + 360;
    const { wholeUnits, hasHalf } = normalizeHalfUnitCount(bucketStart, 180);
    return hasHalf ? formatHalfStep(wholeUnits, '年', direction) : `${formatWholeUnitCount(wholeUnits, '年')}${direction}`;
}

export function calculateTodayRelation(todayDate, targetDate) {
    const diffDays = calculateDateDiffDays(todayDate, targetDate);
    return diffDays === null ? '' : formatRelativeDays(diffDays);
}
