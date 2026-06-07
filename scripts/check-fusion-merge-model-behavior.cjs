const assert = require('assert/strict');
const { pathToFileURL } = require('url');

function moduleUrl(path) {
    return `${pathToFileURL(path).href}?freshness=${Date.now()}`;
}

function createTemplate(sheetMap) {
    return {
        mate: { type: 'chatSheets', version: 1 },
        ...Object.fromEntries(Object.entries(sheetMap).map(([key, sheet], index) => [key, {
            name: sheet.name,
            orderNo: index,
            sourceData: { source: key },
            content: [['id', 'text'], [String(index), sheet.name]],
        }])),
    };
}

function byId(selection, id) {
    const item = selection.find((candidate) => candidate.id === id);
    assert.ok(item, `missing selection item: ${id}`);
    return item;
}

function sheetKeys(template) {
    return Object.keys(template).filter((key) => key.startsWith('sheet_'));
}

function assertMergedTemplateIntegrity(template) {
    const keys = sheetKeys(template);
    assert.deepEqual(keys.map((key) => template[key].orderNo), keys.map((_, index) => index));
    const actualOutputKeys = new Set(keys);
    template.mate.fusionMeta.sources
        .flatMap((source) => source.sheets)
        .forEach((sheet) => {
            assert.equal(actualOutputKeys.has(sheet.outputSheetKey), true);
            assert.equal(template[sheet.outputSheetKey].name, sheet.name);
        });
}

(async () => {
    const mergeModel = await import(moduleUrl('modules/phone-fusion/merge-model.js'));
    const sourceModel = await import(moduleUrl('modules/phone-fusion/source-model.js'));
    const {
        FUSION_CONFLICT_TYPES,
        FUSION_CONFLICT_STRATEGIES,
        buildFusionSelectionModel,
        buildMergedFusionTemplate,
        buildFusionMergeResult,
    } = mergeModel;
    const { createLocalJsonSourceModel, validateFusionTemplate } = sourceModel;

    assert.equal(typeof buildFusionSelectionModel, 'function');
    assert.equal(typeof buildMergedFusionTemplate, 'function');
    assert.equal(typeof buildFusionMergeResult, 'function');

    assert.deepEqual(FUSION_CONFLICT_TYPES, Object.freeze({
        SHEET_KEY: 'sheetKey',
        NAME: 'name',
        BOTH: 'both',
    }));
    assert.deepEqual(FUSION_CONFLICT_STRATEGIES, Object.freeze({
        REPLACE: 'replace',
        KEEP_BOTH: 'keepBoth',
        RENAME: 'rename',
    }));

    const sourceA = createLocalJsonSourceModel(createTemplate({
        sheet_shared: { name: 'A 独占 key 名' },
        sheet_name_a: { name: '同名表' },
        sheet_both: { name: '双冲突表' },
        sheet_invalid: { name: '非法表' },
    }), 'a.json');
    sourceA.rawData.sheet_invalid.sourceData = undefined;
    const normalizedA = createLocalJsonSourceModel(sourceA.rawData, 'a.json');

    const sourceB = createLocalJsonSourceModel(createTemplate({
        sheet_shared: { name: 'B 独占 key 名' },
        sheet_name_b: { name: '同名表' },
        sheet_both: { name: '双冲突表' },
        sheet_unique_b: { name: 'B 唯一表' },
    }), 'b.json');

    const selection = buildFusionSelectionModel([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ]);

    assert.equal(selection.length, 7);
    assert.equal(byId(selection, 'A:sheet_shared').conflictType, FUSION_CONFLICT_TYPES.SHEET_KEY);
    assert.equal(byId(selection, 'B:sheet_shared').conflictType, FUSION_CONFLICT_TYPES.SHEET_KEY);
    assert.equal(byId(selection, 'A:sheet_name_a').conflictType, FUSION_CONFLICT_TYPES.NAME);
    assert.equal(byId(selection, 'B:sheet_name_b').conflictType, FUSION_CONFLICT_TYPES.NAME);
    assert.equal(byId(selection, 'A:sheet_both').conflictType, FUSION_CONFLICT_TYPES.BOTH);
    assert.equal(byId(selection, 'B:sheet_both').conflictType, FUSION_CONFLICT_TYPES.BOTH);
    assert.equal(byId(selection, 'B:sheet_unique_b').conflictType, '');
    assert.equal(selection.some((item) => item.id === 'A:sheet_invalid'), false);

    assert.equal(byId(selection, 'A:sheet_shared').selected, true);
    assert.equal(byId(selection, 'B:sheet_shared').selected, false);
    assert.equal(byId(selection, 'B:sheet_unique_b').selected, true);

    const defaultMerged = buildMergedFusionTemplate(selection, { generatedAt: '2026-06-06T12:00:00.000Z' });
    assert.equal(defaultMerged.mate.type, 'chatSheets');
    assert.equal(defaultMerged.mate.version, 1);
    assert.equal(defaultMerged.mate.fusionMeta.generatedBy, 'yuzi-phone-fusion');
    assert.equal(defaultMerged.mate.fusionMeta.generatedAt, '2026-06-06T12:00:00.000Z');
    assert.equal(defaultMerged.mate.fusionMeta.sources.length, 2);

    const defaultKeys = sheetKeys(defaultMerged);
    assert.deepEqual(defaultKeys, ['sheet_shared', 'sheet_name_a', 'sheet_both', 'sheet_unique_b']);
    assert.deepEqual(defaultKeys.map((key) => defaultMerged[key].orderNo), [0, 1, 2, 3]);
    assert.equal(defaultMerged.sheet_shared.name, 'A 独占 key 名');
    assert.equal(defaultMerged.sheet_unique_b.name, 'B 唯一表');
    assert.equal(validateFusionTemplate(defaultMerged).valid, true);
    assertMergedTemplateIntegrity(defaultMerged);


    const replaceSelection = buildFusionSelectionModel([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ], {
        overrides: {
            'A:sheet_shared': { selected: false, conflictStrategy: FUSION_CONFLICT_STRATEGIES.REPLACE },
            'B:sheet_shared': { selected: true, conflictStrategy: FUSION_CONFLICT_STRATEGIES.REPLACE },
            'A:sheet_name_a': { selected: false },
            'A:sheet_both': { selected: false },
        },
    });
    const replaceMerged = buildMergedFusionTemplate(replaceSelection, { generatedAt: '2026-06-06T12:05:00.000Z' });
    assert.equal(replaceMerged.sheet_shared.name, 'B 独占 key 名');
    assert.equal(sheetKeys(replaceMerged).includes('sheet_shared_2'), false);
    assert.equal(replaceMerged.mate.fusionMeta.sources
        .flatMap((source) => source.sheets)
        .some((sheet) => sheet.key === 'sheet_invalid'), false);

    const replaceDoubleSelected = buildFusionSelectionModel([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ], {
        overrides: {
            'B:sheet_shared': { selected: true, conflictStrategy: FUSION_CONFLICT_STRATEGIES.REPLACE },
            'A:sheet_name_a': { selected: false },
            'A:sheet_both': { selected: false },
        },
    });
    const replaceDoubleMerged = buildMergedFusionTemplate(replaceDoubleSelected, { generatedAt: '2026-06-06T12:07:00.000Z' });
    assert.equal(replaceDoubleMerged.sheet_shared.name, 'B 独占 key 名');
    assert.equal(sheetKeys(replaceDoubleMerged).includes('sheet_shared_2'), false);
    assert.equal(replaceDoubleMerged.mate.fusionMeta.sources
        .flatMap((source) => source.sheets)
        .filter((sheet) => sheet.outputSheetKey === 'sheet_shared').length, 1);
    assertMergedTemplateIntegrity(replaceDoubleMerged);

    const keepBothSelection = buildFusionSelectionModel([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ], {
        overrides: {
            'B:sheet_shared': { selected: true, conflictStrategy: FUSION_CONFLICT_STRATEGIES.KEEP_BOTH },
            'A:sheet_name_a': { selected: false },
            'A:sheet_both': { selected: false },
        },
    });
    const keepBothMerged = buildMergedFusionTemplate(keepBothSelection, { generatedAt: '2026-06-06T12:10:00.000Z' });
    assert.equal(keepBothMerged.sheet_shared.name, 'A 独占 key 名');
    assert.equal(keepBothMerged.sheet_shared_2.name, 'B 独占 key 名');
    assert.equal(keepBothMerged.mate.fusionMeta.sources
        .flatMap((source) => source.sheets)
        .some((sheet) => sheet.outputSheetKey === 'sheet_shared_2'), true);
    assertMergedTemplateIntegrity(keepBothMerged);

    const renameSelection = buildFusionSelectionModel([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ], {
        overrides: {
            'B:sheet_name_b': {
                selected: true,
                conflictStrategy: FUSION_CONFLICT_STRATEGIES.RENAME,
                outputSheetKey: 'sheet_renamed_b',
                outputName: 'B 重命名表',
            },
            'A:sheet_shared': { selected: false },
            'A:sheet_both': { selected: false },
        },
    });
    const renameMerged = buildMergedFusionTemplate(renameSelection, { generatedAt: '2026-06-06T12:15:00.000Z' });
    assert.equal(renameMerged.sheet_renamed_b.name, 'B 重命名表');
    assert.equal(renameMerged.mate.fusionMeta.sources
        .flatMap((source) => source.sheets)
        .some((sheet) => sheet.outputSheetKey === 'sheet_renamed_b' && sheet.name === 'B 重命名表'), true);
    assertMergedTemplateIntegrity(renameMerged);

    const unselectedSelection = buildFusionSelectionModel([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ], {
        overrides: {
            'B:sheet_unique_b': { selected: false },
        },
    });
    const unselectedMerged = buildMergedFusionTemplate(unselectedSelection, { generatedAt: '2026-06-06T12:20:00.000Z' });
    assert.equal(sheetKeys(unselectedMerged).includes('sheet_unique_b'), false);
    assert.equal(unselectedMerged.mate.fusionMeta.sources
        .flatMap((source) => source.sheets)
        .some((sheet) => sheet.key === 'sheet_unique_b'), false);
    assertMergedTemplateIntegrity(unselectedMerged);

    const mergeResult = buildFusionMergeResult([
        { origin: 'A', source: normalizedA },
        { origin: 'B', source: sourceB },
    ], { generatedAt: '2026-06-06T12:25:00.000Z' });
    assert.equal(Array.isArray(mergeResult.selectionModel), true);
    assert.equal(mergeResult.selectionModel.length, selection.length);
    assert.deepEqual(sheetKeys(mergeResult.mergedTemplate), sheetKeys(defaultMerged));
    assert.equal(validateFusionTemplate(mergeResult.mergedTemplate).valid, true);
    assertMergedTemplateIntegrity(mergeResult.mergedTemplate);

    console.log('check-fusion-merge-model-behavior: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
