const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const repositoryPath = path.join(ROOT, 'modules', 'phone-core', 'data-api', 'import-export-repository.js');
const barrelPath = path.join(ROOT, 'modules', 'phone-core', 'data-api.js');

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

function setApi(api) {
    global.window = {
        parent: { AutoCardUpdaterAPI: api },
        AutoCardUpdaterAPI: null,
    };
}

async function loadRepository() {
    return import(`${toModuleUrl('modules/phone-core/data-api/import-export-repository.js')}?t=${Date.now()}`);
}

async function loadBarrel() {
    return import(`${toModuleUrl('modules/phone-core/data-api.js')}?t=${Date.now()}`);
}

function neverSettles() {
    return new Promise(() => {});
}

async function main() {
    assert.ok(fs.existsSync(repositoryPath), '缺少 import-export-repository.js');
    const source = fs.readFileSync(repositoryPath, 'utf8');
    const barrel = fs.readFileSync(barrelPath, 'utf8');

    assert.match(source, /export async function exportDatabaseSnapshotViaApi/);
    assert.match(source, /export async function importTemplateFromDataViaApi/);
    assert.match(source, /export async function refreshDatabaseProjectionViaApi/);
    assert.doesNotMatch(source, /dangerouslyImportFullSnapshotViaApi/);
    assert.doesNotMatch(source, /importTableAsJson/);
    assert.doesNotMatch(barrel, /dangerouslyImportFullSnapshotViaApi/);

    setApi(null);
    const repo = await loadRepository();
    let result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_unavailable');

    setApi({});
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'method_unavailable');

    setApi({ exportTableAsJson: () => ({ mate: { type: 'chatSheets' }, sheet_1: { name: 'A' } }) });
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, true);
    assert.equal(result.code, 'ok');
    assert.equal(result.data.sheet_1.name, 'A');

    setApi({ exportTableAsJson: () => [] });
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_response');

    setApi({ exportTableAsJson: () => false });
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_response');

    setApi({ exportTableAsJson: () => { throw new Error('export boom'); } });
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');

    setApi({ exportTableAsJson: () => Promise.reject(new Error('export rejected')) });
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');

    setApi({ exportTableAsJson: () => neverSettles() });
    result = await repo.exportDatabaseSnapshotViaApi({ timeout: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');


    const template = { mate: { type: 'chatSheets' }, sheet_1: { name: 'A', content: [[]], sourceData: {} } };
    let receivedTemplate = null;
    let receivedOptions = null;
    setApi({
        importTemplateFromData(value, options) {
            receivedTemplate = value;
            receivedOptions = options;
            return true;
        },
    });
    result = await repo.importTemplateFromDataViaApi(template, { scope: 'global', presetName: '缝合结果', timeout: 20 });
    assert.equal(result.ok, true);
    assert.equal(result.scope, 'global');
    assert.equal(receivedTemplate, template);
    assert.deepEqual(receivedOptions, { scope: 'global', presetName: '缝合结果' });

    receivedTemplate = null;
    receivedOptions = null;
    setApi({
        importTemplateFromData(value, options) {
            receivedTemplate = value;
            receivedOptions = options;
            return { imported: true };
        },
    });
    result = await repo.importTemplateFromDataViaApi(template, { presetName: '  缝合结果  ', timeout: 20 });
    assert.equal(result.ok, true);
    assert.equal(result.scope, 'chat');
    assert.equal(receivedTemplate, template);
    assert.deepEqual(receivedOptions, { scope: 'chat', presetName: '缝合结果' });
    assert.deepEqual(result.data.options, { scope: 'chat', presetName: '缝合结果' });

    receivedOptions = null;
    setApi({
        importTemplateFromData(value, options) {
            receivedOptions = options;
            return true;
        },
    });
    result = await repo.importTemplateFromDataViaApi(template, { scope: 'global', presetName: '   ', timeout: 20 });
    assert.equal(result.ok, true);
    assert.deepEqual(receivedOptions, { scope: 'global' });

    setApi({ importTemplateFromData: () => false });
    result = await repo.importTemplateFromDataViaApi(template, { scope: 'chat', timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'import_rejected');
    assert.equal(result.scope, 'chat');

    result = await repo.importTemplateFromDataViaApi(null, { timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_input');

    setApi({ importTemplateFromData: () => { throw new Error('template import boom'); } });
    result = await repo.importTemplateFromDataViaApi(template, { scope: 'global', timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');
    assert.equal(result.scope, 'global');

    setApi({ importTemplateFromData: () => Promise.reject(new Error('template import rejected')) });
    result = await repo.importTemplateFromDataViaApi(template, { scope: 'chat', timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');
    assert.equal(result.scope, 'chat');

    setApi({ importTemplateFromData: () => neverSettles() });
    result = await repo.importTemplateFromDataViaApi(template, { scope: 'global', timeout: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');
    assert.equal(result.scope, 'global');

    setApi({ refreshDataAndWorldbook: () => true });
    result = await repo.refreshDatabaseProjectionViaApi({ timeout: 20 });
    assert.equal(result.ok, true);
    assert.equal(result.code, 'ok');

    setApi({ refreshDataAndWorldbook: () => false });
    result = await repo.refreshDatabaseProjectionViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'refresh_rejected');

    setApi({ refreshDataAndWorldbook: () => { throw new Error('refresh boom'); } });
    result = await repo.refreshDatabaseProjectionViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');

    setApi({ refreshDataAndWorldbook: () => Promise.reject(new Error('refresh rejected')) });
    result = await repo.refreshDatabaseProjectionViaApi({ timeout: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');

    setApi({ refreshDataAndWorldbook: () => neverSettles() });
    result = await repo.refreshDatabaseProjectionViaApi({ timeout: 5 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'api_call_failed');

    const barrelModule = await loadBarrel();
    assert.equal(typeof barrelModule.exportDatabaseSnapshotViaApi, 'function');
    assert.equal(typeof barrelModule.importTemplateFromDataViaApi, 'function');
    assert.equal(typeof barrelModule.refreshDatabaseProjectionViaApi, 'function');
    assert.equal(typeof barrelModule.dangerouslyImportFullSnapshotViaApi, 'undefined');

    console.log('[fusion-import-export-repository-check] 检查通过');
}

main().catch((error) => {
    console.error('[fusion-import-export-repository-check] 检查失败：');
    console.error(error);
    process.exitCode = 1;
});
