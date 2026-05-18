const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DATE_RELATION_MODULE_PATH = path.join(ROOT, 'modules', 'phone-core', 'date-relation.js');

async function loadDateRelationModule() {
    return import(pathToFileURL(DATE_RELATION_MODULE_PATH).href);
}

function assertEqual(actual, expected, message) {
    assert.strictEqual(actual, expected, message);
}

function assertParsedDate(parsed, expectedKey, message) {
    assert.ok(parsed, `${message}: expected parsed date`);
    assertEqual(parsed.key, expectedKey, message);
}

async function main() {
    const mod = await loadDateRelationModule();

    const requiredExports = [
        'extractFirstDateFromTimeSpan',
        'parseFirstDateFromTimeSpan',
        'extractRelationDateFromTimeSpan',
        'parseRelationDateFromTimeSpan',
        'parseDateText',
        'calculateTodayRelation',
    ];

    requiredExports.forEach((name) => {
        assertEqual(typeof mod[name], 'function', `date-relation 必须导出 ${name}`);
    });

    assertEqual(
        mod.extractFirstDateFromTimeSpan('2024-04-02 18:00 ~ 2024-04-03 10:30'),
        '2024-04-02',
        '旧 first-date 语义必须保持读取时间跨度左侧日期',
    );
    assertParsedDate(
        mod.parseFirstDateFromTimeSpan('2024-04-02 18:00 ~ 2024-04-03 10:30'),
        '2024-04-02',
        'parseFirstDateFromTimeSpan 必须保持旧语义',
    );

    const extractionCases = [
        ['2024-04-02 18:00 ~ 2024-04-03 10:30', '2024-04-03', '范围时间必须优先提取结束日期'],
        ['2024-04-02 18:00 ~ 2024-04-03 00:00', '2024-04-03', '结束时间为零点仍必须提取结束日期'],
        ['2024-04-02 18:00', '2024-04-02', '单时间点必须回退开头日期'],
        ['2024-04-02 18:00 ~ ', '2024-04-02', '右侧为空必须回退开头日期'],
        ['2024-04-02 18:00 ~ 未知', '2024-04-02', '右侧不可解析必须回退开头日期'],
        ['丰收纪-丰收月-08 18:00 ~ 丰收纪-丰收月-09 20:30', '丰收纪-丰收月-09', '抽象三段式必须优先提取结束日期'],
    ];

    extractionCases.forEach(([timeSpan, expected, message]) => {
        assertEqual(mod.extractRelationDateFromTimeSpan(timeSpan), expected, message);
    });

    assertParsedDate(
        mod.parseRelationDateFromTimeSpan('2024-04-02 18:00 ~ 2024-04-03 10:30'),
        '2024-04-03',
        'parseRelationDateFromTimeSpan 必须解析结束日期',
    );
    assertParsedDate(
        mod.parseRelationDateFromTimeSpan('2024-04-02 18:00'),
        '2024-04-02',
        'parseRelationDateFromTimeSpan 必须保留单时间点回退',
    );

    assertEqual(
        mod.extractRelationDateFromTimeSpan('丰收月-08 18:00 ~ 丰收月-09 20:30'),
        '',
        '两段式抽象日期不得被时间跨度提取层恢复支持',
    );
    assertEqual(
        mod.parseRelationDateFromTimeSpan('丰收月-08 18:00 ~ 丰收月-09 20:30'),
        null,
        '两段式抽象日期不得被 parseRelationDateFromTimeSpan 恢复支持',
    );
    assertParsedDate(
        mod.parseRelationDateFromTimeSpan('2024-04-30 18:00 ~ 2024-04-32 20:00'),
        '2024-04-30',
        '结束日期文本存在但语义非法时必须回退到有效起始日期',
    );
    assertEqual(
        mod.parseRelationDateFromTimeSpan('2024-04-31 18:00 ~ 2024-04-32 20:00'),
        null,
        '起始日期和结束日期都非法时不得被 parseRelationDateFromTimeSpan 接受',
    );

    const today = mod.parseDateText('2024-04-03');
    const target = mod.parseRelationDateFromTimeSpan('2024-04-02 18:00 ~ 2024-04-03 10:30');
    assertEqual(
        mod.calculateTodayRelation(today, target),
        '今天',
        '用户截图场景：今天为 2024-04-03 且时间跨度结束于 2024-04-03 时必须输出今天',
    );

    console.log('[通过] 日期关系合同：纪要时间跨度结束日期优先、单点回退、旧 first-date 语义保持');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
