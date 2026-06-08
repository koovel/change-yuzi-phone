const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    render: 'modules/phone-fusion/render.js',
    templates: 'modules/phone-fusion/templates.js',
    utils: 'modules/phone-fusion/utils.js',
    runtime: 'modules/phone-fusion/runtime.js',
    interactions: 'modules/phone-fusion/interactions.js',
    compareMerge: 'modules/phone-fusion/compare-merge.js',
    styles: 'styles/phone-base/05-update-fusion-feedback.css',
};

const REMOVED_FACADE = 'modules/phone-fusion.js';

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function has(content, snippet) {
    return content.includes(snippet);
}

function countOccurrences(content, snippet) {
    if (!snippet) return 0;
    let count = 0;
    let index = content.indexOf(snippet);
    while (index !== -1) {
        count += 1;
        index = content.indexOf(snippet, index + snippet.length);
    }
    return count;
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];

    results.push({
        file: REMOVED_FACADE,
        description: 'phone-fusion 根级入口已删除',
        ok: !exists(REMOVED_FACADE),
    });

    check(results, 'render', 'render 入口继续暴露 `renderFusion()`', has(contents.render, 'export function renderFusion(container)'));
    check(results, 'render', 'render 入口继续组合模板模块', has(contents.render, "from './templates.js'"));
    check(results, 'render', 'render 入口继续组合 runtime 模块', has(contents.render, "from './runtime.js'"));
    check(results, 'render', 'render 入口继续组合交互模块', has(contents.render, "from './interactions.js'"));

    check(results, 'templates', '存在 `buildFusionPageHtml()`', has(contents.templates, 'export function buildFusionPageHtml()'));
    check(results, 'templates', '存在 `buildFusionCompareRowHtml()`', has(contents.templates, 'export function buildFusionCompareRowHtml('));
    check(results, 'templates', '存在 `buildFusionCompareHtml()`', has(contents.templates, 'export function buildFusionCompareHtml('));
    check(results, 'templates', '存在 `buildFusionSuccessResultHtml()`', has(contents.templates, 'export function buildFusionSuccessResultHtml('));

    check(results, 'utils', '存在 `extractSheets()`', has(contents.utils, 'export function extractSheets('));
    check(results, 'utils', '存在 `pickJsonFile()`', has(contents.utils, 'export function pickJsonFile('));

    check(results, 'runtime', '存在 `cleanupFusionPageResources()`', has(contents.runtime, 'export function cleanupFusionPageResources()'));
    check(results, 'runtime', '存在 `bindFusionContainerCleanup()`', has(contents.runtime, 'export function bindFusionContainerCleanup('));
    check(results, 'runtime', '存在 `clearFusionResult()`', has(contents.runtime, 'export function clearFusionResult('));

    check(results, 'interactions', '存在 `createFusionInteractionController()`', has(contents.interactions, 'export function createFusionInteractionController('));
    check(results, 'interactions', '存在 `reportFusionError()`', has(contents.interactions, 'export function reportFusionError('));

    check(results, 'templates', '模板 A 支持使用内置小剧场+纪要表', has(contents.templates, '使用内置小剧场+纪要表'));
    check(results, 'templates', '旧的内置小剧场模板文案已删除', !has(contents.templates, '使用内置小剧场模板'));
    check(results, 'templates', '模板 A/B 继续支持导入本地 JSON', has(contents.templates, '导入本地 JSON'));
    check(results, 'templates', '模板 B 使用简化后的当前表格文案', has(contents.templates, '选择当前表格'));
    check(results, 'templates', '旧的当前数据库表格按钮文案已删除', !has(contents.templates, '从当前数据库表格选择'));
    check(results, 'templates', '模板 A/B 来源图标统一使用 upload', !has(contents.templates, 'PHONE_ICONS.puzzle') && countOccurrences(contents.templates, 'PHONE_ICONS.upload') >= 2);
    check(results, 'templates', '导入为模板/预设入口在 phase-6 已启用', has(contents.templates, 'id="phone-fusion-import-template" title="将合并结果导入为数据库模板/预设"'));
    check(results, 'templates', '导入为模板/预设入口不再是 phase-6 禁用占位', !has(contents.templates, 'id="phone-fusion-import-template" disabled'));
    check(results, 'templates', '导入目标提供 scope 选择', has(contents.templates, 'id="phone-fusion-template-scope"'));
    check(results, 'templates', '导入目标提供 presetName 输入', has(contents.templates, 'id="phone-fusion-template-preset-name"'));
    check(results, 'templates', '高级危险操作 UI 已删除', !has(contents.templates, '高级危险操作') && !has(contents.templates, 'phone-fusion-danger-advanced'));
    check(results, 'templates', '危险覆盖按钮与文案已删除', !has(contents.templates, 'phone-fusion-danger-overwrite') && !has(contents.templates, '覆盖当前数据库'));
    check(results, 'templates', 'compare row 写入 selection id', has(contents.templates, 'data-id='));

    check(results, 'interactions', 'interactions 从 source-model 导入本地/内置/当前数据库 source 工厂', has(contents.interactions, "from './source-model.js'"));
    check(results, 'interactions', 'interactions 通过 data-api 读取当前数据库表格', has(contents.interactions, "from '../phone-core/data-api.js'"));
    check(results, 'interactions', 'interactions 不直接调用 AutoCardUpdaterAPI', !has(contents.interactions, 'AutoCardUpdaterAPI'));
    check(results, 'interactions', 'interactions 不直接调用底层 importTableAsJson', !has(contents.interactions, 'importTableAsJson'));
    check(results, 'interactions', 'interactions 接入安全模板导入 API', has(contents.interactions, 'importTemplateFromDataViaApi'));
    check(results, 'interactions', 'interactions 不再导入危险覆盖 repository API', !has(contents.interactions, 'dangerouslyImportFullSnapshotViaApi'));
    check(results, 'interactions', 'interactions 不再保留危险覆盖 handler', !has(contents.interactions, 'onDangerousOverwrite'));
    check(results, 'interactions', 'interactions 不再绑定危险覆盖按钮', !has(contents.interactions, 'phone-fusion-danger-overwrite'));
    check(results, 'interactions', 'interactions 不再保留危险覆盖备份 helper', !has(contents.interactions, 'createBackupDownloadLink'));
    check(results, 'interactions', 'interactions 不再保留 best-effort rollback 链路', !has(contents.interactions, 'bestEffortRollback'));
    check(results, 'interactions', 'interactions 不再保留危险读回比较 helper', !has(contents.interactions, 'compareSnapshotForReadback'));
    check(results, 'interactions', 'interactions 导入成功后刷新数据库投影', has(contents.interactions, 'refreshDatabaseProjectionViaApi'));
    check(results, 'interactions', 'interactions 导入前执行最终模板校验', has(contents.interactions, 'validateFusionTemplate'));
    check(results, 'interactions', '当前数据库空数据有明确错误提示', has(contents.interactions, '当前数据库表格为空'));
    check(results, 'interactions', '内置来源标签同步为小剧场+纪要表', has(contents.interactions, '内置小剧场+纪要表'));

    check(results, 'compareMerge', 'compare-merge 接入 merge-model', has(contents.compareMerge, "from './merge-model.js'"));
    check(results, 'compareMerge', 'compare-merge 接入 source-model 兼容旧本地 JSON', has(contents.compareMerge, 'createLegacyCompatibleSourceModel'));
    check(results, 'compareMerge', 'performFusionMerge 返回合并模板供安全导入复用', has(contents.compareMerge, 'return { mergedTemplate, sheetCount }'));
    check(results, 'compareMerge', 'compare-merge 不再依赖旧 extractSheets 渲染合并', !has(contents.compareMerge, 'extractSheets'));

    check(results, 'styles', 'phase-5 来源按钮有样式', has(contents.styles, '.phone-fusion-page .phone-fusion-source-action'));
    check(results, 'styles', 'phase-6 导入目标选项有样式', has(contents.styles, '.phone-fusion-page .phone-fusion-template-options'));
    check(results, 'styles', '高级危险区域样式已删除', !has(contents.styles, 'phone-fusion-danger-advanced') && !has(contents.styles, 'phone-fusion-danger-btn'));
    check(results, 'styles', 'Fusion source select option 有浅色样式加固', has(contents.styles, '.phone-fusion-page .phone-fusion-source-select option') && has(contents.styles, 'background-color: var(--yuzi-settings-surface, #F5F3EF) !important'));
    check(results, 'styles', 'Fusion template select/input 有浅色样式加固', has(contents.styles, '.phone-fusion-page .phone-fusion-template-option select,') && has(contents.styles, '-webkit-text-fill-color: var(--yuzi-settings-text-primary, #3A3731)'));
    check(results, 'styles', 'Fusion presetName input 有 caret 颜色加固', has(contents.styles, 'caret-color: var(--yuzi-settings-text-primary, #3A3731)'));

    const failed = results.filter(item => !item.ok);
    if (failed.length > 0) {
        console.error('[fusion-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[fusion-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
