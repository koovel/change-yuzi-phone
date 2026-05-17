const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const TABLE_SOURCE_SCRIPT = path.join(ROOT, 'scripts', 'table-source.cjs');
const SOURCE_DIR = path.join(ROOT, 'tables', 'sources', '小剧场2.1');
const GENERATED_JSON = path.join(ROOT, 'tables', 'generated', '小剧场2.1.json');

function toRelative(filePath) {
    return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function runTableSourceCheck() {
    return spawnSync(process.execPath, [TABLE_SOURCE_SCRIPT, 'check', SOURCE_DIR], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
    });
}

function fail(message, details = '') {
    console.error(`[table-sources-contract] ${message}`);
    if (details) {
        console.error(details.trim());
    }
    process.exitCode = 1;
}

function main() {
    if (!fs.existsSync(TABLE_SOURCE_SCRIPT)) {
        fail(`缺少表格事实源工具：${toRelative(TABLE_SOURCE_SCRIPT)}`);
        return;
    }
    if (!fs.existsSync(SOURCE_DIR) || !fs.statSync(SOURCE_DIR).isDirectory()) {
        fail(`缺少表格 Markdown 事实源目录：${toRelative(SOURCE_DIR)}`);
        return;
    }

    const result = runTableSourceCheck();
    if (result.status !== 0) {
        fail('表格 Markdown 事实源校验失败', `${result.stdout || ''}\n${result.stderr || ''}`);
        return;
    }

    if (!fs.existsSync(GENERATED_JSON)) {
        fail(`缺少合成产物：${toRelative(GENERATED_JSON)}，请运行 npm run tables:build`);
        return;
    }

    try {
        JSON.parse(fs.readFileSync(GENERATED_JSON, 'utf8'));
    } catch (error) {
        fail(`合成产物不是合法 JSON：${toRelative(GENERATED_JSON)}`, error.message);
        return;
    }

    console.log('[table-sources-contract] 检查通过');
    console.log(result.stdout.trim());
    console.log(`- OK | ${toRelative(SOURCE_DIR)} | Markdown 事实源可解析且结构有效`);
    console.log(`- OK | ${toRelative(GENERATED_JSON)} | 合成 JSON 可解析`);
}

main();
