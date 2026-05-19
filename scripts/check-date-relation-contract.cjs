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
        'parseLeadingDateFromText',
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
        '2024-05-02',
        '结束日期只要是三段式就必须按宽松现实日期自然溢出计算，不得回退起始日期',
    );
    assertParsedDate(
        mod.parseRelationDateFromTimeSpan('2024-04-31 18:00 ~ 2024-04-32 20:00'),
        '2024-05-02',
        '起始日期和结束日期超出真实月天数时仍必须接受三段式并优先使用结束日期',
    );
    assertParsedDate(
        mod.parseLeadingDateFromText('2026-02-31 09:00'),
        '2026-03-03',
        '全局当前时间开头的非法现实日期三段式必须自然溢出参与计算',
    );
    assertParsedDate(
        mod.parseLeadingDateFromText('二零二六-二-三十一 09:00'),
        '2026-03-03',
        '全局当前时间开头的中文数字现实日期必须解析为同一日序号',
    );
    assertParsedDate(
        mod.parseLeadingDateFromText('丰收纪-丰收月-九 17:25'),
        '2029-03-09',
        '全局当前时间开头的抽象三段式中文数字日必须参与计算',
    );
    assertEqual(
        mod.parseLeadingDateFromText('丰收月-09 17:25'),
        null,
        '两段式日期仍缺少年/纪元事实，不得被当前时间解析层恢复支持',
    );

    const today = mod.parseDateText('2024-04-03');
    const target = mod.parseRelationDateFromTimeSpan('2024-04-02 18:00 ~ 2024-04-03 10:30');
    assertEqual(
        mod.calculateTodayRelation(today, target),
        '今天',
        '用户截图场景：今天为 2024-04-03 且时间跨度结束于 2024-04-03 时必须输出今天',
    );

    console.log('[通过] 日期关系合同：结束日期优先、单点回退、宽松三段式与中文数字解析、旧 first-date 语义保持');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
