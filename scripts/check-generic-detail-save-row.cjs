const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'modules/table-viewer/detail-edit-controller.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function extractFunctionBody(name, pattern) {
    const match = pattern.exec(source);
    assert(match, `未找到 ${name} 函数`);

    let index = match.index + match[0].length;
    let depth = 1;
    while (index < source.length && depth > 0) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        index += 1;
    }

    assert(depth === 0, `${name} 函数体括号不平衡`);
    return source.slice(match.index, index);
}

function assertOrdered(haystack, tokens, label) {
    let cursor = -1;
    for (const token of tokens) {
        const next = haystack.indexOf(token, cursor + 1);
        assert(next !== -1, `${label} 缺少片段：${token}`);
        assert(next > cursor, `${label} 片段顺序错误：${token}`);
        cursor = next;
    }
}

assert(!source.includes('function cloneTableDataForSave'), '详情保存禁止恢复整库保存快照 helper');
assert(!source.includes('saveTableData'), '详情保存禁止调用整库保存入口 saveTableData');
assert(!source.includes('getTableData'), '详情保存不应重新读取整库快照作为写入基准');

const saveBody = extractFunctionBody(
    'handleSaveRow',
    /async\s+function\s+handleSaveRow\s*\([^)]*\)\s*{/,
);

assertOrdered(saveBody, [
    'const saveRowIndex = Number(state.rowIndex);',
    'state.setSaving(true);',
    'const dataRowIndex = saveRowIndex + 1;',
    'const updateData = {};',
    'const liveTableName = typeof getLiveTableName === \'function\' ? String(getLiveTableName() || \'\').trim() : \'\';',
    'const result = await updateTableRow(liveTableName, dataRowIndex, updateData);',
    'rows[saveRowIndex][rawColIndex] = draft;',
], 'handleSaveRow');

assert(saveBody.includes('保存失败：行索引无效'), '保存开始时必须校验捕获行号');
assert(saveBody.includes('保存失败：缺少表格名称'), '行级保存缺少表名时必须给用户明确反馈');
assert(saveBody.includes('保存失败：数据库行级更新接口不可用'), '行级更新依赖缺失时必须阻断保存');
assert(saveBody.includes('context: { sheetKey, rowIndex: saveRowIndex }'), '异常日志必须使用保存开始时捕获的行号');
assert(!saveBody.includes('rows[state.rowIndex]'), '保存成功后不能使用可变 state.rowIndex 回写本地 rows');
assert(!/updateTableRow\([^,]+,\s*state\.rowIndex/.test(saveBody), '保存时不能用可变 state.rowIndex 定位数据库行');
assert(!saveBody.includes('const success = await'), '行级保存必须检查结构化 result.ok，而不是压缩成布尔 success');

console.log('check-generic-detail-save-row: ok');
