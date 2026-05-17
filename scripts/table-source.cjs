const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.cwd();
const REQUIRED_SHEET_SECTIONS = [
    'sourceData.note',
    'sourceData.initNode',
    'sourceData.deleteNode',
    'sourceData.updateNode',
    'sourceData.insertNode',
    'sourceData.ddl',
    'content',
    'updateConfig',
    'exportConfig',
];

function usage() {
    return [
        'Usage:',
        '  node scripts/table-source.cjs split <inputJson> <outputDir> [--force]',
        '  node scripts/table-source.cjs check <sourceDir>',
        '  node scripts/table-source.cjs build <sourceDir> <outputJson>',
        '  node scripts/table-source.cjs roundtrip <inputJson>',
        '',
        'Examples:',
        '  node scripts/table-source.cjs split docs/reference/小剧场2.1.json tables/sources/小剧场2.1 --force',
        '  node scripts/table-source.cjs check tables/sources/小剧场2.1',
        '  node scripts/table-source.cjs build tables/sources/小剧场2.1 tables/generated/小剧场2.1.json',
    ].join('\n');
}

function toAbsolute(inputPath) {
    return path.isAbsolute(inputPath) ? inputPath : path.resolve(ROOT, inputPath);
}

function toPosix(relativeOrAbsolutePath) {
    return relativeOrAbsolutePath.replace(/\\/g, '/');
}

function readText(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeText(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(readText(filePath));
    } catch (error) {
        throw new Error(`无法解析 JSON 文件 ${toPosix(path.relative(ROOT, filePath))}: ${error.message}`);
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function padIndex(index) {
    return String(index).padStart(2, '0');
}

function sanitizeFileNameSegment(value) {
    const sanitized = String(value || '').trim().replace(/[<>:"/\\|?*]/g, '＿');
    if (!sanitized) {
        throw new Error('表名为空，无法生成文件名');
    }
    return sanitized;
}

function sheetFileName(sheet) {
    return `${padIndex(sheet.orderNo + 1)}-${sanitizeFileNameSegment(sheet.name)}.md`;
}

function parseFrontmatter(content, fileLabel) {
    const normalized = content.replace(/^\uFEFF/, '');
    const lines = normalized.split(/\r?\n/);
    if (lines[0] !== '---') {
        throw new Error(`${fileLabel}: 缺少文件开头 frontmatter 分隔符 ---`);
    }

    let endIndex = -1;
    for (let index = 1; index < lines.length; index += 1) {
        if (lines[index] === '---') {
            endIndex = index;
            break;
        }
    }
    if (endIndex < 0) {
        throw new Error(`${fileLabel}: frontmatter 未闭合`);
    }

    const meta = {};
    for (let index = 1; index < endIndex; index += 1) {
        const line = lines[index];
        if (!line.trim()) continue;
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            throw new Error(`${fileLabel}: frontmatter 第 ${index + 1} 行不是 key: value 格式`);
        }
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key) {
            throw new Error(`${fileLabel}: frontmatter 存在空 key`);
        }
        if (Object.prototype.hasOwnProperty.call(meta, key)) {
            throw new Error(`${fileLabel}: frontmatter key 重复：${key}`);
        }
        meta[key] = value;
    }

    const body = lines.slice(endIndex + 1).join('\n');
    return { meta, body };
}

function parseSections(body, fileLabel) {
    const lines = body.split(/\r?\n/);
    const sections = new Map();
    let currentName = null;
    let currentStart = 0;
    let inFence = false;

    function commitSection(endIndex) {
        if (!currentName) return;
        const content = lines.slice(currentStart, endIndex).join('\n').replace(/^\n+|\n+$/g, '');
        if (sections.has(currentName)) {
            throw new Error(`${fileLabel}: section 重复：${currentName}`);
        }
        sections.set(currentName, content);
    }

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('```')) {
            inFence = !inFence;
        }
        if (!inFence && line.startsWith('## ')) {
            commitSection(index);
            currentName = line.slice(3).trim();
            if (!currentName) {
                throw new Error(`${fileLabel}: 第 ${index + 1} 行存在空 section 标题`);
            }
            currentStart = index + 1;
        }
    }
    if (inFence) {
        throw new Error(`${fileLabel}: 存在未闭合 fenced code block`);
    }
    commitSection(lines.length);
    return sections;
}

function extractTitle(body) {
    const match = body.match(/^#\s+(.+)\s*$/m);
    return match ? match[1].trim() : '';
}

function extractCodeBlock(sectionContent, expectedLang, fileLabel, sectionName) {
    const lines = sectionContent.split(/\r?\n/);
    let startIndex = -1;
    let lang = '';
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('```')) {
            startIndex = index;
            lang = line.slice(3).trim().toLowerCase();
            break;
        }
    }
    if (startIndex < 0) {
        throw new Error(`${fileLabel}: section ${sectionName} 缺少 fenced code block`);
    }
    if (lang !== expectedLang) {
        throw new Error(`${fileLabel}: section ${sectionName} 的代码块语言必须为 ${expectedLang}，当前为 ${lang || '(空)'}`);
    }

    let endIndex = -1;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        if (lines[index].startsWith('```')) {
            endIndex = index;
            break;
        }
    }
    if (endIndex < 0) {
        throw new Error(`${fileLabel}: section ${sectionName} 的 fenced code block 未闭合`);
    }
    return lines.slice(startIndex + 1, endIndex).join('\n');
}

function parseJsonBlock(sectionContent, fileLabel, sectionName) {
    const raw = extractCodeBlock(sectionContent, 'json', fileLabel, sectionName);
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`${fileLabel}: section ${sectionName} 的 JSON 解析失败：${error.message}`);
    }
}

function stringifyFrontmatter(meta) {
    return ['---', ...Object.entries(meta).map(([key, value]) => `${key}: ${value}`), '---'].join('\n');
}

function buildMateMarkdown(mate) {
    return `${stringifyFrontmatter({ type: 'mate' })}\n\n# mate\n\n## data\n\n\`\`\`json\n${JSON.stringify(mate, null, 2)}\n\`\`\`\n`;
}

function buildSheetMarkdown(sheet) {
    const sourceData = sheet.sourceData || {};
    return `${stringifyFrontmatter({
        type: 'sheet',
        uid: sheet.uid,
        name: sheet.name,
        orderNo: sheet.orderNo,
    })}\n\n# ${sheet.name}\n\n## sourceData.note\n\n${sourceData.note || ''}\n\n## sourceData.initNode\n\n${sourceData.initNode || ''}\n\n## sourceData.deleteNode\n\n${sourceData.deleteNode || ''}\n\n## sourceData.updateNode\n\n${sourceData.updateNode || ''}\n\n## sourceData.insertNode\n\n${sourceData.insertNode || ''}\n\n## sourceData.ddl\n\n\`\`\`sql\n${sourceData.ddl || ''}\n\`\`\`\n\n## content\n\n\`\`\`json\n${JSON.stringify(sheet.content, null, 2)}\n\`\`\`\n\n## updateConfig\n\n\`\`\`json\n${JSON.stringify(sheet.updateConfig, null, 2)}\n\`\`\`\n\n## exportConfig\n\n\`\`\`json\n${JSON.stringify(sheet.exportConfig, null, 2)}\n\`\`\`\n`;
}

function collectSheetsFromTemplate(template) {
    if (!isPlainObject(template)) {
        throw new Error('输入 JSON 顶层必须是对象');
    }
    if (!isPlainObject(template.mate)) {
        throw new Error('输入 JSON 缺少对象类型的 mate');
    }

    const sheets = [];
    const orderNos = new Map();
    for (const [key, value] of Object.entries(template)) {
        if (key === 'mate') continue;
        if (!isPlainObject(value)) {
            throw new Error(`顶层字段 ${key} 不是 sheet 对象`);
        }
        validateRawSheetForSplit(value, key);
        if (key !== value.uid) {
            throw new Error(`顶层 key ${key} 与 sheet.uid ${value.uid} 不一致`);
        }
        if (orderNos.has(value.orderNo)) {
            throw new Error(`orderNo 重复：${value.orderNo} (${orderNos.get(value.orderNo)} / ${value.name})`);
        }
        orderNos.set(value.orderNo, value.name);
        sheets.push(value);
    }
    sheets.sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name, 'zh-CN'));
    return { mate: template.mate, sheets };
}

function validateRawSheetForSplit(sheet, key) {
    const prefix = `sheet ${key}`;
    if (typeof sheet.uid !== 'string' || !sheet.uid.trim()) throw new Error(`${prefix}: uid 必须为非空字符串`);
    if (typeof sheet.name !== 'string' || !sheet.name.trim()) throw new Error(`${prefix}: name 必须为非空字符串`);
    if (!Number.isInteger(sheet.orderNo) || sheet.orderNo < 0) throw new Error(`${prefix}: orderNo 必须为非负整数`);
    if (!isPlainObject(sheet.sourceData)) throw new Error(`${prefix}: sourceData 必须为对象`);
    for (const field of ['note', 'initNode', 'deleteNode', 'updateNode', 'insertNode', 'ddl']) {
        if (typeof sheet.sourceData[field] !== 'string') {
            throw new Error(`${prefix}: sourceData.${field} 必须为字符串`);
        }
    }
    if (!Array.isArray(sheet.content)) throw new Error(`${prefix}: content 必须为数组`);
    if (!isPlainObject(sheet.updateConfig)) throw new Error(`${prefix}: updateConfig 必须为对象`);
    if (!isPlainObject(sheet.exportConfig)) throw new Error(`${prefix}: exportConfig 必须为对象`);
}

function cleanExistingMarkdownFiles(outputDir) {
    if (!fs.existsSync(outputDir)) return;
    const stat = fs.statSync(outputDir);
    if (!stat.isDirectory()) {
        throw new Error(`输出路径不是目录：${toPosix(path.relative(ROOT, outputDir))}`);
    }
    for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            fs.unlinkSync(path.join(outputDir, entry.name));
        }
    }
}

function assertCanWriteSplitOutput(outputDir, force) {
    if (!fs.existsSync(outputDir)) return;
    const stat = fs.statSync(outputDir);
    if (!stat.isDirectory()) {
        throw new Error(`输出路径不是目录：${toPosix(path.relative(ROOT, outputDir))}`);
    }
    const existingMarkdownFiles = fs.readdirSync(outputDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => entry.name);
    if (existingMarkdownFiles.length > 0 && !force) {
        throw new Error(`输出目录已存在 Markdown 文件：${existingMarkdownFiles.join(', ')}。如需覆盖，请添加 --force`);
    }
}

function splitTemplate(inputJsonPath, outputDir, options = {}) {
    const template = readJsonFile(inputJsonPath);
    const { mate, sheets } = collectSheetsFromTemplate(template);
    assertCanWriteSplitOutput(outputDir, Boolean(options.force));
    if (options.force) {
        cleanExistingMarkdownFiles(outputDir);
    }
    fs.mkdirSync(outputDir, { recursive: true });
    writeText(path.join(outputDir, '00-mate.md'), buildMateMarkdown(mate));
    for (const sheet of sheets) {
        writeText(path.join(outputDir, sheetFileName(sheet)), buildSheetMarkdown(sheet));
    }
    return { mateCount: 1, sheetCount: sheets.length };
}

function loadMarkdownFile(filePath) {
    const relativePath = toPosix(path.relative(ROOT, filePath));
    const content = readText(filePath);
    const { meta, body } = parseFrontmatter(content, relativePath);
    const sections = parseSections(body, relativePath);
    const title = extractTitle(body);
    return { filePath, relativePath, meta, body, sections, title };
}

function parseOrderNo(value, fileLabel) {
    if (!/^\d+$/.test(String(value || ''))) {
        throw new Error(`${fileLabel}: orderNo 必须为非负整数`);
    }
    return Number(value);
}

function parseSheetMarkdown(parsed) {
    const { meta, sections, title, relativePath } = parsed;
    const uid = String(meta.uid || '').trim();
    const name = String(meta.name || '').trim();
    const orderNo = parseOrderNo(meta.orderNo, relativePath);
    if (!uid) throw new Error(`${relativePath}: uid 必填`);
    if (!name) throw new Error(`${relativePath}: name 必填`);
    if (title !== name) {
        throw new Error(`${relativePath}: 一级标题 ${title || '(缺失)'} 与 name ${name} 不一致`);
    }

    for (const sectionName of REQUIRED_SHEET_SECTIONS) {
        if (!sections.has(sectionName)) {
            throw new Error(`${relativePath}: 缺少 section ${sectionName}`);
        }
    }

    const note = sections.get('sourceData.note').trim();
    if (!note) {
        throw new Error(`${relativePath}: sourceData.note 不允许为空`);
    }
    const ddl = extractCodeBlock(sections.get('sourceData.ddl'), 'sql', relativePath, 'sourceData.ddl');
    if (!ddl.trim()) {
        throw new Error(`${relativePath}: sourceData.ddl 不允许为空`);
    }

    const content = parseJsonBlock(sections.get('content'), relativePath, 'content');
    if (!Array.isArray(content) || !Array.isArray(content[0]) || content[0].length === 0) {
        throw new Error(`${relativePath}: content 必须是首行非空的二维数组`);
    }
    const updateConfig = parseJsonBlock(sections.get('updateConfig'), relativePath, 'updateConfig');
    if (!isPlainObject(updateConfig)) {
        throw new Error(`${relativePath}: updateConfig 必须为对象`);
    }
    const exportConfig = parseJsonBlock(sections.get('exportConfig'), relativePath, 'exportConfig');
    if (!isPlainObject(exportConfig)) {
        throw new Error(`${relativePath}: exportConfig 必须为对象`);
    }

    return {
        uid,
        name,
        sourceData: {
            note,
            initNode: sections.get('sourceData.initNode').trim(),
            deleteNode: sections.get('sourceData.deleteNode').trim(),
            updateNode: sections.get('sourceData.updateNode').trim(),
            insertNode: sections.get('sourceData.insertNode').trim(),
            ddl,
        },
        content,
        updateConfig,
        exportConfig,
        orderNo,
        __filePath: parsed.filePath,
        __relativePath: relativePath,
    };
}

function parseMateMarkdown(parsed) {
    const { sections, title, relativePath } = parsed;
    if (title !== 'mate') {
        throw new Error(`${relativePath}: mate 文件一级标题必须为 mate`);
    }
    if (!sections.has('data')) {
        throw new Error(`${relativePath}: mate 文件缺少 section data`);
    }
    const mate = parseJsonBlock(sections.get('data'), relativePath, 'data');
    if (!isPlainObject(mate)) {
        throw new Error(`${relativePath}: mate data 必须为对象`);
    }
    if (mate.type !== 'chatSheets') {
        throw new Error(`${relativePath}: mate.type 必须为 chatSheets`);
    }
    if (!Object.prototype.hasOwnProperty.call(mate, 'version')) {
        throw new Error(`${relativePath}: mate.version 必填`);
    }
    return { data: mate, __filePath: parsed.filePath, __relativePath: relativePath };
}

function assertSheetFileNumber(sheet) {
    const basename = path.basename(sheet.__filePath);
    const match = basename.match(/^(\d+)-/);
    if (!match) {
        throw new Error(`${sheet.__relativePath}: 文件名必须以两位编号和短横线开头，例如 02-表名.md`);
    }
    const actual = Number(match[1]);
    const expected = sheet.orderNo + 1;
    if (actual !== expected) {
        throw new Error(`${sheet.__relativePath}: 文件编号 ${actual} 与 orderNo + 1 (${expected}) 不一致`);
    }
}

function loadSourceDirectory(sourceDir) {
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`source 目录不存在：${toPosix(path.relative(ROOT, sourceDir))}`);
    }
    if (!fs.statSync(sourceDir).isDirectory()) {
        throw new Error(`source 路径不是目录：${toPosix(path.relative(ROOT, sourceDir))}`);
    }

    const markdownFiles = fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map(entry => path.join(sourceDir, entry.name))
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN'));

    if (markdownFiles.length === 0) {
        throw new Error(`source 目录没有 Markdown 文件：${toPosix(path.relative(ROOT, sourceDir))}`);
    }

    let mate = null;
    const sheets = [];
    for (const filePath of markdownFiles) {
        const parsed = loadMarkdownFile(filePath);
        const type = String(parsed.meta.type || '').trim();
        if (type === 'mate') {
            if (mate) {
                throw new Error(`${parsed.relativePath}: 只能存在一个 type: mate 文件，已存在 ${mate.__relativePath}`);
            }
            mate = parseMateMarkdown(parsed);
        } else if (type === 'sheet') {
            sheets.push(parseSheetMarkdown(parsed));
        } else {
            throw new Error(`${parsed.relativePath}: 未知或缺失 frontmatter type：${type || '(空)'}`);
        }
    }

    if (!mate) {
        throw new Error('source 目录缺少 type: mate 文件');
    }
    if (sheets.length === 0) {
        throw new Error('source 目录至少需要一个 type: sheet 文件');
    }

    validateUniqueSheets(sheets);
    for (const sheet of sheets) {
        assertSheetFileNumber(sheet);
    }
    sheets.sort((a, b) => a.orderNo - b.orderNo || a.name.localeCompare(b.name, 'zh-CN'));
    return { mate, sheets };
}

function validateUniqueSheets(sheets) {
    const maps = {
        uid: new Map(),
        name: new Map(),
        orderNo: new Map(),
    };
    for (const sheet of sheets) {
        for (const field of Object.keys(maps)) {
            const value = sheet[field];
            if (maps[field].has(value)) {
                throw new Error(`${sheet.__relativePath}: ${field} 重复：${value}，已存在于 ${maps[field].get(value)}`);
            }
            maps[field].set(value, sheet.__relativePath);
        }
    }
}

function stripInternalFields(sheet) {
    return {
        uid: sheet.uid,
        name: sheet.name,
        sourceData: sheet.sourceData,
        content: sheet.content,
        updateConfig: sheet.updateConfig,
        exportConfig: sheet.exportConfig,
        orderNo: sheet.orderNo,
    };
}

function buildTemplateFromSource(sourceDir) {
    const { mate, sheets } = loadSourceDirectory(sourceDir);
    const output = { mate: mate.data };
    for (const sheet of sheets) {
        output[sheet.uid] = stripInternalFields(sheet);
    }
    return output;
}

function writeTemplateFromSource(sourceDir, outputJsonPath) {
    const output = buildTemplateFromSource(sourceDir);
    writeText(outputJsonPath, formatJson(output));
    return output;
}

function checkSourceDirectory(sourceDir) {
    const { mate, sheets } = loadSourceDirectory(sourceDir);
    return { mateCount: mate ? 1 : 0, sheetCount: sheets.length };
}

function roundtripTemplate(inputJsonPath) {
    const original = readJsonFile(inputJsonPath);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuzi-phone-table-source-'));
    try {
        const sourceDir = path.join(tempDir, 'source');
        const outputJsonPath = path.join(tempDir, 'output.json');
        splitTemplate(inputJsonPath, sourceDir, { force: true });
        const rebuilt = writeTemplateFromSource(sourceDir, outputJsonPath);
        const originalString = JSON.stringify(original);
        const rebuiltString = JSON.stringify(rebuilt);
        if (originalString !== rebuiltString) {
            throw new Error('roundtrip 失败：split 后 build 的 JSON 与原始 JSON 不等价');
        }
        return true;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function runCli(argv) {
    const [command, ...args] = argv;
    if (!command) {
        console.error(usage());
        return 1;
    }

    if (command === 'split') {
        const [inputJson, outputDir, ...rest] = args;
        if (!inputJson || !outputDir) {
            console.error(usage());
            return 1;
        }
        const force = rest.includes('--force');
        const result = splitTemplate(toAbsolute(inputJson), toAbsolute(outputDir), { force });
        console.log(`[table-source] split 完成：mate ${result.mateCount} 个，sheet ${result.sheetCount} 个 -> ${toPosix(outputDir)}`);
        return 0;
    }

    if (command === 'check') {
        const [sourceDir] = args;
        if (!sourceDir) {
            console.error(usage());
            return 1;
        }
        const result = checkSourceDirectory(toAbsolute(sourceDir));
        console.log(`[table-source] check 通过：mate ${result.mateCount} 个，sheet ${result.sheetCount} 个`);
        return 0;
    }

    if (command === 'build') {
        const [sourceDir, outputJson] = args;
        if (!sourceDir || !outputJson) {
            console.error(usage());
            return 1;
        }
        const output = writeTemplateFromSource(toAbsolute(sourceDir), toAbsolute(outputJson));
        console.log(`[table-source] build 完成：${Object.keys(output).length - 1} 张表 -> ${toPosix(outputJson)}`);
        return 0;
    }

    if (command === 'roundtrip') {
        const [inputJson] = args;
        if (!inputJson) {
            console.error(usage());
            return 1;
        }
        roundtripTemplate(toAbsolute(inputJson));
        console.log(`[table-source] roundtrip 通过：${toPosix(inputJson)}`);
        return 0;
    }

    console.error(`未知命令：${command}\n\n${usage()}`);
    return 1;
}

if (require.main === module) {
    try {
        process.exitCode = runCli(process.argv.slice(2));
    } catch (error) {
        console.error(`[table-source] ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {
    parseFrontmatter,
    parseSections,
    extractCodeBlock,
    splitTemplate,
    loadSourceDirectory,
    buildTemplateFromSource,
    writeTemplateFromSource,
    roundtripTemplate,
};
