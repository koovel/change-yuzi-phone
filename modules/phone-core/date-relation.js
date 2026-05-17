const FALLBACK_ANCHOR = Object.freeze({ year: 2026, monthIndex: 0, day: 1 });
const ABSTRACT_YEAR_BUCKETS = 7;
const ABSTRACT_MONTHS_PER_YEAR = 12;
const ABSTRACT_DAYS_PER_MONTH = 30;
const ABSTRACT_DAYS_PER_YEAR = ABSTRACT_MONTHS_PER_YEAR * ABSTRACT_DAYS_PER_MONTH;

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

function parseRealDateText(text) {
    const match = normalizeDateText(text).match(/^([+-]?\d{1,})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isSafeInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12) return null;

    const monthIndex = month - 1;
    const maxDay = getRealMonthDays(year, monthIndex);
    if (day < 1 || day > maxDay) return null;

    return {
        kind: 'real',
        raw: normalizeDateText(text),
        year,
        monthIndex,
        day,
        key: formatDateKey(year, monthIndex, day),
        label: formatDateLabel(year, monthIndex, day),
        monthDays: maxDay,
        daySerial: computeRealDateSerial(year, month, day),
    };
}

function parseAbstractDateText(text, monthDaysValue = '') {
    const value = normalizeDateText(text);
    const match = value.match(/^(.+?)-(.+?)-(\d{1,2})$/);
    if (!match) return null;

    const yearLabel = normalizeDateText(match[1]);
    const monthLabel = normalizeDateText(match[2]);
    const numericDay = Number(match[3]);
    if (!yearLabel || !monthLabel || !Number.isInteger(numericDay)) return null;

    const monthDays = normalizeAbstractMonthDays(monthDaysValue);
    const day = clampDay(numericDay, monthDays);
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

    const year = Number(anchor?.year);
    const monthIndex = Number(anchor?.monthIndex);
    const day = Number(anchor?.day);
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;

    const date = new Date(year, monthIndex, day + safeOffset);
    return {
        year: date.getFullYear(),
        monthIndex: date.getMonth(),
        day: date.getDate(),
        key: formatDateKey(date.getFullYear(), date.getMonth(), date.getDate()),
        label: formatDateLabel(date.getFullYear(), date.getMonth(), date.getDate()),
        kind: 'real-derived',
    };
}

export function extractFirstDateFromTimeSpan(timeSpan) {
    const text = normalizeDateText(timeSpan);
    if (!text) return '';

    const realMatch = text.match(/^[+-]?\d{1,}-\d{1,2}-\d{1,2}(?=\s|$|~)/);
    if (realMatch) return realMatch[0];

    const abstractMatch = text.match(/^(.+?-.+?-\d{1,2})(?=\s|$|~)/);
    return abstractMatch ? abstractMatch[1].trim() : '';
}

export function parseFirstDateFromTimeSpan(timeSpan, monthDaysValue = '') {
    const firstDate = extractFirstDateFromTimeSpan(timeSpan);
    return firstDate ? parseDateText(firstDate, monthDaysValue) : null;
}

function resolveAbstractYearIndex(yearLabel) {
    const numeric = normalizeDateText(yearLabel).match(/^[+-]?\d+$/);
    if (numeric) {
        return BigInt(numeric[0]);
    }
    return BigInt(hashStringToIndex(yearLabel, ABSTRACT_YEAR_BUCKETS));
}

function floorDiv(value, divisor) {
    const quotient = value / divisor;
    const remainder = value % divisor;
    return remainder < 0n ? quotient - 1n : quotient;
}

function isLeapYearBigInt(year) {
    return (year % 4n === 0n && year % 100n !== 0n) || year % 400n === 0n;
}

function daysBeforeYear(year) {
    const y = year - 1n;
    return y * 365n + floorDiv(y, 4n) - floorDiv(y, 100n) + floorDiv(y, 400n);
}

function computeRealDateSerial(year, month, day) {
    const monthDays = [31n, isLeapYearBigInt(BigInt(year)) ? 29n : 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
    let days = daysBeforeYear(BigInt(year));
    for (let index = 0; index < month - 1; index += 1) {
        days += monthDays[index];
    }
    return days + BigInt(day - 1);
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
