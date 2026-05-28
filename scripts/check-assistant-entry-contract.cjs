const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FILES = {
    assistantEntry: 'modules/assistant/entry.js',
    build: 'build.mjs',
    assistantScript: '酒馆助手脚本-于子手机.json',
    fontLibraryService: 'modules/settings-app/services/appearance-settings/font-library-service.js',
    preload: 'modules/phone-core/preload.js',
};

const CDN_URL = 'https://cdn.jsdelivr.net/gh/yuzi83/st-yuzi-phone@main/dist/assistant/yuzi-phone.assistant.js';

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function has(content, snippet) {
    return content.includes(snippet);
}

function check(results, file, description, ok) {
    results.push({ file, description, ok });
}

function main() {
    const entry = read(FILES.assistantEntry);
    const build = read(FILES.build);
    const assistantScriptRaw = read(FILES.assistantScript);
    const assistantScript = JSON.parse(assistantScriptRaw);
    const assistantContent = String(assistantScript.content || '');
    const fontLibraryService = read(FILES.fontLibraryService);
    const preload = read(FILES.preload);
    const results = [];

    check(results, FILES.assistantEntry, 'assistant 入口暴露 window.YuziPhoneAssistant', has(entry, 'window.YuziPhoneAssistant = api;'));
    check(results, FILES.assistantEntry, 'assistant 入口暴露 init', has(entry, 'export async function init()'));
    check(results, FILES.assistantEntry, 'assistant 入口暴露 destroy', has(entry, 'export function destroy()'));
    check(results, FILES.assistantEntry, 'assistant 入口包含生命周期令牌', has(entry, 'let lifecycleToken = 0;'));
    check(results, FILES.assistantEntry, 'assistant 入口包含窗口事件绑定状态', has(entry, 'let windowEventsBound = false;'));
    check(results, FILES.assistantEntry, 'assistant 入口包含 DOM ready 防护', has(entry, 'function waitForDomReady(token)'));
    check(results, FILES.assistantEntry, 'assistant 入口包含初始化失败回滚', has(entry, 'function rollbackInitializationFailure(error, token, runId)'));
    check(results, FILES.assistantEntry, 'assistant 入口包含 DOM ready waiter 取消', has(entry, 'function cancelPendingDomReadyWaiter(reason'));
    check(results, FILES.assistantEntry, 'assistant 入口包含全局 API 冲突拒绝策略', has(entry, 'api.global_collision_rejected'));
    check(results, 'modules/bootstrap/app-bootstrap.js', 'bootstrap 初始化支持 shouldAbort 取消检查', has(read('modules/bootstrap/app-bootstrap.js'), 'const assertNotAborted = () => {'));
    check(results, 'modules/bootstrap/app-bootstrap.js', 'bootstrap registerEventListeners 透传 shouldAbort', has(read('modules/bootstrap/app-bootstrap.js'), 'await registerEventListeners({ shouldAbort });'));
    check(results, 'modules/bootstrap/event-registry.js', 'event-registry 包含局部监听清理', has(read('modules/bootstrap/event-registry.js'), 'const cleanupRegisteredListeners = () => {'));
    check(results, 'modules/bootstrap/event-registry.js', 'event-registry 注册前后检查 shouldAbort', has(read('modules/bootstrap/event-registry.js'), 'const registerManagedListener = async (register) => {'));
    check(results, FILES.assistantEntry, 'assistant 入口包含窗口事件幂等绑定', has(entry, 'function ensureWindowEventsBound()'));
    check(results, FILES.assistantEntry, 'assistant 入口 Slash 安装兼容已注册状态', has(entry, 'if (slashRegisteredNow || isSlashCommandsRegistered()) {'));
    check(results, FILES.assistantEntry, 'assistant 入口不在模块顶层直接绑定 window 事件', !has(entry, 'bindPhoneBootstrapWindowEvents(globalEventManager);\n\nconst api = {'));
    check(results, FILES.assistantEntry, 'assistant 入口不导入 index.js', !has(entry, "from '../index.js'") && !has(entry, 'from \"../index.js\"'));
    check(results, FILES.assistantEntry, 'assistant 入口不导入 settings-panel.js', !has(entry, 'settings-panel.js'));

    check(results, FILES.build, 'build 包含 assistant js 输出', has(build, 'assistant/yuzi-phone.assistant.js'));
    check(results, FILES.build, 'build 包含 assistant css 输出', has(build, 'assistant/yuzi-phone.assistant.css'));
    check(results, FILES.build, 'build 包含 assistant 入口', has(build, "modules/assistant/entry.js"));

    check(results, FILES.assistantEntry, 'CDN URL 常量符合设计约束（文档对照）', CDN_URL === 'https://cdn.jsdelivr.net/gh/yuzi83/st-yuzi-phone@main/dist/assistant/yuzi-phone.assistant.js');

    check(results, FILES.assistantScript, '酒馆助手脚本 JSON 可解析', !!assistantScript && typeof assistantScript === 'object' && !Array.isArray(assistantScript));
    check(results, FILES.assistantScript, '酒馆助手脚本类型为 script', assistantScript.type === 'script');
    check(results, FILES.assistantScript, '酒馆助手脚本默认启用', assistantScript.enabled === true);
    check(results, FILES.assistantScript, '酒馆助手脚本为非按钮自动执行形态', assistantScript.button?.enabled === false && Array.isArray(assistantScript.button?.buttons) && assistantScript.button.buttons.length === 0);
    check(results, FILES.assistantScript, '酒馆助手脚本不包含 export_with', !Object.prototype.hasOwnProperty.call(assistantScript, 'export_with'));
    check(results, FILES.assistantScript, 'loader 使用固定 assistant CDN', has(assistantContent, CDN_URL));
    check(results, FILES.assistantScript, 'loader 保留单实例脚本标记', has(assistantContent, 'data-yuzi-phone-assistant-loader'));
    check(results, FILES.assistantScript, 'loader 以 module script 加载 assistant ESM 产物', has(assistantContent, "script.type = 'module'"));
    check(results, FILES.assistantScript, 'loader 初始化 window.YuziPhoneAssistant', has(assistantContent, 'window.YuziPhoneAssistant') && has(assistantContent, 'safeInit'));

    check(results, FILES.fontLibraryService, 'assistant bundle 资源根路径回到扩展根', has(fontLibraryService, "/dist\\/assistant\\/yuzi-phone\\.assistant\\.js") && has(fontLibraryService, "new URL('../../', moduleUrl)"));
    check(results, FILES.fontLibraryService, '原 dist bundle 资源根路径保持扩展根', has(fontLibraryService, "normalizedModuleUrl.includes('/dist/')") && has(fontLibraryService, "new URL('../', moduleUrl)"));
    check(results, FILES.fontLibraryService, '源码开发路径资源根路径保持不变', has(fontLibraryService, "new URL('../../../../', moduleUrl)"));
    check(results, FILES.preload, 'assistant bundle 被识别为单 bundle runtime', has(preload, 'assistant\\/yuzi-phone\\.assistant'));
    check(results, FILES.preload, '原扩展 bundle 仍被识别为单 bundle runtime', has(preload, 'yuzi-phone\\.bundle'));

    const failed = results.filter(item => !item.ok);
    if (failed.length > 0) {
        console.error('[assistant-entry-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[assistant-entry-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
