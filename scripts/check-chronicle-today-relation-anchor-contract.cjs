const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'modules', 'phone-core', 'derived-fields', 'chronicle-today-relation.js');

function assertIncludes(source, needle, message) {
    assert.ok(source.includes(needle), message);
}

function assertNotIncludes(source, needle, message) {
    assert.ok(!source.includes(needle), message);
}

function main() {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');

    assertIncludes(
        source,
        "const GLOBAL_TABLE_NAME = '全局数据表';",
        '与今天关系派生锚点必须固定读取全局数据表',
    );
    assertIncludes(
        source,
        "const HEADER_CURRENT_TIME = '当前时间';",
        '与今天关系派生锚点必须固定读取当前时间字段',
    );
    assertIncludes(
        source,
        'const globalTable = tables[GLOBAL_TABLE_NAME];',
        'resolveTables 必须解析全局数据表而不是小日历表',
    );
    assertIncludes(
        source,
        'const currentTimeText = normalizeText(readCell(rows[0], globalIndexes.currentTime));',
        '全局当前时间锚点必须读取全局数据表首行',
    );
    assertIncludes(
        source,
        'return parseLeadingDateFromText(currentTimeText);',
        '当前时间字段必须按开头三段式日期解析',
    );
    assertIncludes(
        source,
        'function buildDerivedInputSignature(todayDate, chronicleSignature)',
        '派生输入签名必须显式合并 today anchor 与纪要输入',
    );
    assertIncludes(
        source,
        'buildDateSignature(todayDate)',
        '派生输入签名必须包含解析后的 today anchor',
    );
    assertIncludes(
        source,
        'const rowId = normalizeText(readCell(row, chronicleIndexes.rowId)) || `@row:${index + 1}`;',
        '纪要输入签名必须保留自动行号列或行序号 fallback，防止行身份塌陷',
    );
    assertIncludes(
        source,
        'const timeSpan = normalizeText(readCell(row, chronicleIndexes.timeSpan));',
        '纪要输入签名必须继续包含时间跨度',
    );
    assertIncludes(
        source,
        'updateTableCell(',
        '与今天关系写回必须继续走行级单元格更新 API',
    );
    assertIncludes(
        source,
        'const latestInputSignature = buildDerivedInputSignature(latestTodayDate, latestChronicleSignature);',
        '写前二次校验必须重新计算包含 today anchor 的组合签名',
    );

    assertNotIncludes(
        source,
        "CALENDAR_TABLE_NAME = '小日历表'",
        '与今天关系派生不得再把小日历表作为 today anchor 来源',
    );
    assertNotIncludes(
        source,
        'HEADER_CALENDAR_DATE',
        '与今天关系派生不得再依赖小日历日期字段',
    );
    assertNotIncludes(
        source,
        'HEADER_MONTH_DAYS',
        '与今天关系派生不得再依赖小日历月份几天字段',
    );
    assertNotIncludes(
        source,
        'TODAY_RELATION_VALUE',
        '与今天关系派生不得再扫描小日历“今天”行',
    );
    assertNotIncludes(
        source,
        'findTodayDate',
        '旧小日历 today 行扫描函数必须移除',
    );
    assertNotIncludes(
        source,
        'parseDateText',
        '全局当前时间锚点必须使用 parseLeadingDateFromText，而不是整字段 parseDateText',
    );

    console.log('[通过] 纪要与今天关系锚点合同：读取全局数据表当前时间、排除小日历、组合签名、行级写回');
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
