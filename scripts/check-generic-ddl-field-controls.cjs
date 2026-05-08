const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const FILES = {
    ddlFieldMetadata: 'modules/table-viewer/ddl-field-metadata.js',
    genericRuntime: 'modules/table-viewer/generic-runtime.js',
    listPageRenderer: 'modules/table-viewer/list-page-renderer.js',
    addRowModal: 'modules/table-viewer/add-row-modal.js',
    detailPageRenderer: 'modules/table-viewer/detail-page-renderer.js',
    detailRowPayload: 'modules/table-viewer/detail-row-payload.js',
    detailPageTemplate: 'modules/table-viewer/detail-page-template.js',
    detailEditController: 'modules/table-viewer/detail-edit-controller.js',
    mergedTemplateSample: 'docs/reference/merged-template-sample.json',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertIncludes(source, snippet, message) {
    assert(source.includes(snippet), message);
}

function assertNotIncludes(source, snippet, message) {
    assert(!source.includes(snippet), message);
}

function assertArrayEquals(actual, expected, message) {
    assert(Array.isArray(actual), `${message}: actual 不是数组`);
    assert(actual.length === expected.length, `${message}: 长度不一致，actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    expected.forEach((expectedValue, index) => {
        assert(actual[index] === expectedValue, `${message}: 第 ${index} 项不一致，actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    });
}

function getInventorySheet() {
    const sample = JSON.parse(read(FILES.mergedTemplateSample));
    const sheet = sample.sheet_inventory;
    assert(sheet && typeof sheet === 'object', '真实模板样例必须包含 sheet_inventory 物品表');
    assert(sheet.sourceData && typeof sheet.sourceData.ddl === 'string', '物品表必须包含 sourceData.ddl');
    assert(Array.isArray(sheet.content?.[0]), '物品表必须包含表头行');
    return sheet;
}

async function runExecutableMetadataContract() {
    const modulePath = path.join(ROOT, FILES.ddlFieldMetadata);
    const {
        createDdlFieldMetadata,
        findFirstEnumValidationError,
        getDdlFieldMetadataForIndex,
    } = await import(pathToFileURL(modulePath).href);

    assert(typeof createDdlFieldMetadata === 'function', 'createDdlFieldMetadata 必须是可执行导出函数');
    assert(typeof findFirstEnumValidationError === 'function', 'findFirstEnumValidationError 必须是可执行导出函数');
    assert(typeof getDdlFieldMetadataForIndex === 'function', 'getDdlFieldMetadataForIndex 必须是可执行导出函数');

    const sheet = getInventorySheet();
    const headers = sheet.content[0];
    const metadata = createDdlFieldMetadata({
        ddl: sheet.sourceData.ddl,
        headers,
        rawHeaders: headers,
    });

    assert(metadata.hasDdl === true, '真实物品表 DDL 必须被识别为存在');
    assert(metadata.enumConstraints.length >= 2, '真实物品表至少应解析出 类型 和 品质 两个枚举约束');

    const typeMetadata = getDdlFieldMetadataForIndex(metadata, 2);
    const qualityMetadata = getDdlFieldMetadataForIndex(metadata, 4);

    assert(typeMetadata?.type === 'enum', '物品表 raw index 2 类型 必须映射为 enum 字段');
    assert(typeMetadata.header === '类型', '物品表 raw index 2 必须映射到中文表头 类型');
    assert(typeMetadata.columnName === 'item_type', '物品表 类型 必须保留 DDL 英文字段 item_type');
    assertArrayEquals(typeMetadata.options, ['消耗品', '材料', '任务物品', '道具'], '物品表 类型 枚举选项必须来自真实 DDL');

    assert(qualityMetadata?.type === 'enum', '物品表 raw index 4 品质 必须映射为 enum 字段');
    assert(qualityMetadata.header === '品质', '物品表 raw index 4 必须映射到中文表头 品质');
    assert(qualityMetadata.columnName === 'quality', '物品表 品质 必须保留 DDL 英文字段 quality');
    assertArrayEquals(qualityMetadata.options, ['普通', '优秀', '稀有', '史诗', '传说', '神话'], '物品表 品质 枚举选项必须来自真实 DDL');

    const invalidType = findFirstEnumValidationError({
        ddlFieldMetadata: metadata,
        data: {
            物品名称: '1',
            类型: '1',
            数量: '1',
            品质: '普通',
            描述: '1',
        },
        fieldIndexes: headers.map((_, index) => index),
    });
    assert(invalidType?.field === '类型', '类型=1 必须在前端枚举校验中被拦截');
    assert(invalidType.message.includes('消耗品、材料、任务物品、道具'), '类型非法值错误信息必须包含允许选项');

    const invalidQuality = findFirstEnumValidationError({
        ddlFieldMetadata: metadata,
        data: {
            物品名称: '1',
            类型: '消耗品',
            数量: '1',
            品质: '1',
            描述: '1',
        },
        fieldIndexes: headers.map((_, index) => index),
    });
    assert(invalidQuality?.field === '品质', '品质=1 必须在前端枚举校验中被拦截');
    assert(invalidQuality.message.includes('普通、优秀、稀有、史诗、传说、神话'), '品质非法值错误信息必须包含允许选项');

    const validPayload = findFirstEnumValidationError({
        ddlFieldMetadata: metadata,
        data: {
            物品名称: '小药瓶',
            类型: '消耗品',
            数量: '1',
            品质: '普通',
            描述: '恢复少量体力',
        },
        fieldIndexes: headers.map((_, index) => index),
    });
    assert(validPayload === null, '合法 类型/品质 不应被枚举前置校验拦截');
}

async function main() {
    const sources = Object.fromEntries(
        Object.entries(FILES)
            .filter(([key]) => key !== 'mergedTemplateSample')
            .map(([key, relativePath]) => [key, read(relativePath)]),
    );

    assertIncludes(
        sources.ddlFieldMetadata,
        'export function createDdlFieldMetadata(options = {}) {',
        '必须提供 createDdlFieldMetadata 作为通用表 DDL 字段元数据入口',
    );
    assertIncludes(
        sources.ddlFieldMetadata,
        'const CHECK_IN_PATTERN =',
        'DDL 元数据模块必须显式解析 CHECK(column IN (...)) 枚举约束',
    );
    assertIncludes(
        sources.ddlFieldMetadata,
        'function parseSqlValueList(listText) {',
        '枚举值解析必须集中在 parseSqlValueList，禁止在 UI 层 split 选项',
    );
    assertIncludes(
        sources.ddlFieldMetadata,
        'function extractLineComment(line) {',
        'DDL 元数据模块必须读取行尾中文注释，用于英文列名到中文表头映射',
    );
    assertIncludes(
        sources.ddlFieldMetadata,
        'export function getDdlFieldMetadataForIndex(ddlFieldMetadata, rawColIndex) {',
        '必须提供按 rawColIndex 查询字段元数据的 helper',
    );
    assertIncludes(
        sources.ddlFieldMetadata,
        'export function findFirstEnumValidationError(options = {}) {',
        '必须提供共享枚举前置校验 helper，避免新增页和详情页复制校验逻辑',
    );
    assertIncludes(
        sources.ddlFieldMetadata,
        "rawValue.trim() === ''",
        '枚举前置校验必须允许空值继续交给数据库 NOT NULL 等约束处理，不能擅自扩大拦截范围',
    );

    assertIncludes(
        sources.genericRuntime,
        "import { createDdlFieldMetadata } from './ddl-field-metadata.js';",
        'generic-runtime 必须导入 createDdlFieldMetadata',
    );
    assertIncludes(
        sources.genericRuntime,
        'const ddlFieldMetadata = createDdlFieldMetadata({',
        'generic-runtime 必须集中构造 ddlFieldMetadata',
    );
    assertIncludes(
        sources.genericRuntime,
        "ddl: sheet?.sourceData?.ddl || ''",
        'ddlFieldMetadata 必须来自 sheet.sourceData.ddl',
    );
    assertNotIncludes(
        sources.genericRuntime,
        "action: 'ddl-field-metadata.resolved'",
        'generic-runtime 不应保留 DDL 元数据成功路径调试日志',
    );
    assertNotIncludes(
        sources.genericRuntime,
        'summarizeDdlFieldMetadata',
        'generic-runtime 不应保留只服务调试日志的 DDL 摘要 helper',
    );
    assertIncludes(
        sources.genericRuntime,
        'ddlFieldMetadata,',
        'generic-runtime 必须把 ddlFieldMetadata 注入列表页和详情页',
    );

    assertIncludes(
        sources.listPageRenderer,
        'ddlFieldMetadata,',
        'list-page-renderer 必须接收并转发 ddlFieldMetadata',
    );

    assertIncludes(
        sources.addRowModal,
        "import { createDdlFieldMetadata, findFirstEnumValidationError, getDdlFieldMetadataForIndex } from './ddl-field-metadata.js';",
        '新增弹窗必须消费 DDL 字段元数据、兜底解析入口和共享校验 helper',
    );
    assertIncludes(
        sources.addRowModal,
        'function buildAddRowFieldControlHtml(field) {',
        '新增弹窗必须通过控件分发函数渲染字段控件',
    );
    assertIncludes(
        sources.addRowModal,
        '<select class="phone-modal-field-input"',
        '新增弹窗枚举字段必须渲染 select，而不是自由文本 textarea',
    );
    assertIncludes(
        sources.addRowModal,
        'function resolveAddRowDdlFieldMetadata(options = {}) {',
        '新增弹窗必须具备本地 DDL 元数据兜底，不能完全依赖 runtime 注入',
    );
    assertIncludes(
        sources.addRowModal,
        'const effectiveDdlFieldMetadata = resolveAddRowDdlFieldMetadata({',
        '新增弹窗必须在构造字段前解析有效 DDL 元数据',
    );
    assertIncludes(
        sources.addRowModal,
        'fieldMetadata: getDdlFieldMetadataForIndex(effectiveDdlFieldMetadata, idx),',
        '新增弹窗字段渲染必须使用 effectiveDdlFieldMetadata',
    );
    assertNotIncludes(
        sources.addRowModal,
        "action: 'add-row.controls.resolved'",
        '新增弹窗不应保留控件解析成功路径调试日志',
    );
    assertNotIncludes(
        sources.addRowModal,
        'summarizeAddRowControls',
        '新增弹窗不应保留只服务控件解析调试日志的摘要 helper',
    );
    assertIncludes(
        sources.addRowModal,
        "modalEventManager.add(input, 'change', syncDraftValue);",
        '新增弹窗必须监听 select change 写入 draftData',
    );
    assertIncludes(
        sources.addRowModal,
        'const enumValidationError = findFirstEnumValidationError({',
        '新增弹窗提交前必须调用共享枚举校验',
    );
    assertIncludes(
        sources.addRowModal,
        'ddlFieldMetadata: effectiveDdlFieldMetadata,',
        '新增弹窗提交前枚举校验必须使用 effectiveDdlFieldMetadata，不能继续使用可能为空的原始参数',
    );
    assertIncludes(
        sources.addRowModal,
        "action: 'add-row.validation-failed'",
        '新增弹窗非法枚举必须记录 add-row.validation-failed 结构化日志',
    );

    assertIncludes(
        sources.detailPageRenderer,
        "import { getTableData } from '../phone-core/data-api.js';",
        'detail-page-renderer 必须能在 runtime 注入缺失时读取当前表快照作为 DDL 元数据兜底来源',
    );
    assertIncludes(
        sources.detailPageRenderer,
        "import { createDdlFieldMetadata } from './ddl-field-metadata.js';",
        'detail-page-renderer 必须具备本地解析 DDL 元数据的能力',
    );
    assertIncludes(
        sources.detailPageRenderer,
        'function resolveDetailDdlFieldMetadata(options = {}) {',
        '详情页必须具备本地 DDL 元数据兜底，不能完全依赖 runtime 注入',
    );
    assertIncludes(
        sources.detailPageRenderer,
        'const effectiveDdlFieldMetadata = resolveDetailDdlFieldMetadata({',
        '详情页必须在构造 payload 前解析有效 DDL 元数据',
    );
    assertIncludes(
        sources.detailPageRenderer,
        'ddlFieldMetadata: effectiveDdlFieldMetadata,',
        '详情页 payload/controller 必须消费 effectiveDdlFieldMetadata',
    );
    assertNotIncludes(
        sources.detailPageRenderer,
        "action: 'detail.controls.resolved'",
        '详情页不应保留控件解析成功路径调试日志',
    );
    assertNotIncludes(
        sources.detailPageRenderer,
        'summarizeDetailControls',
        '详情页不应保留只服务控件解析调试日志的摘要 helper',
    );
    assertIncludes(
        sources.detailRowPayload,
        "import { getDdlFieldMetadataForIndex } from './ddl-field-metadata.js';",
        'detail-row-payload 必须按列查询 DDL 字段元数据',
    );
    assertIncludes(
        sources.detailRowPayload,
        'fieldMetadata: getDdlFieldMetadataForIndex(ddlFieldMetadata, rawColIndex),',
        '详情字段 payload 必须携带 fieldMetadata 供模板渲染 select',
    );

    assertIncludes(
        sources.detailPageTemplate,
        'function buildDetailEditControlHtml(pair) {',
        '详情页模板必须通过控件分发函数渲染编辑控件',
    );
    assertIncludes(
        sources.detailPageTemplate,
        '<select class="phone-row-detail-input"',
        '详情页枚举字段必须渲染 select',
    );
    assertIncludes(
        sources.detailPageTemplate,
        '不在可选项中',
        '详情页必须保留当前脏值选项，避免编辑态静默丢失非法旧值',
    );
    assertIncludes(
        sources.detailPageTemplate,
        "${pair.isLocked ? 'disabled' : ''}",
        '详情页 select 必须保持字段锁 disabled 语义',
    );

    assertIncludes(
        sources.detailEditController,
        "import { findFirstEnumValidationError } from './ddl-field-metadata.js';",
        '详情保存控制器必须使用共享枚举校验 helper',
    );
    assertIncludes(
        sources.detailEditController,
        'event.target instanceof HTMLSelectElement',
        '详情保存控制器必须处理 select change 事件',
    );
    assertIncludes(
        sources.detailEditController,
        "controllerRuntime.addEventListener(container, 'change'",
        '详情保存控制器必须监听 change 事件写入 draftValues',
    );
    assertIncludes(
        sources.detailEditController,
        'const enumValidationError = findFirstEnumValidationError({',
        '详情保存调用 updateTableRow 前必须执行枚举前置校验',
    );
    assertIncludes(
        sources.detailEditController,
        "action: 'row.save.validation-failed'",
        '详情保存非法枚举必须记录 row.save.validation-failed 结构化日志',
    );
    assertNotIncludes(
        sources.detailEditController,
        'getTableData',
        '详情保存控制器仍然禁止直接读取整库快照；DDL 元数据必须通过 runtime/page 注入',
    );

    await runExecutableMetadataContract();

    console.log('[generic-ddl-field-controls-check] 检查通过');
    console.log('- OK | DDL CHECK IN 枚举解析集中在 ddl-field-metadata');
    console.log('- OK | 真实物品表 类型/品质 DDL 枚举映射与非法值拦截通过');
    console.log('- OK | 新增页和详情页均渲染枚举 select 并执行前置校验');
    console.log('- OK | 成功路径 DDL 控件调试日志已从运行时代码移除');
    console.log('- OK | 详情保存控制器未绕过 runtime 注入直接读取整库快照');
}

main().catch((error) => {
    console.error('[generic-ddl-field-controls-check] 检查失败');
    console.error(error);
    process.exit(1);
});
