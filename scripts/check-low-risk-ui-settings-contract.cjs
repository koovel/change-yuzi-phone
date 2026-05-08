const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

const FILES = {
    settingsSchema: 'modules/settings/schema.js',
    settingsPanel: 'modules/settings-panel.js',
    toggleButton: 'modules/bootstrap/toggle-button.js',
    notifications: 'modules/phone-core/notifications.js',
};

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function has(content, snippet) {
    return content.includes(snippet);
}

function indexOfOrMinusOne(content, snippet) {
    return content.indexOf(snippet);
}

function check(results, fileKey, description, ok) {
    results.push({ file: FILES[fileKey], description, ok });
}

function main() {
    const contents = Object.fromEntries(
        Object.entries(FILES).map(([key, relativePath]) => [key, read(relativePath)])
    );

    const results = [];

    check(
        results,
        'settingsSchema',
        '默认保留悬浮按钮显示，避免旧用户升级后失去入口',
        has(contents.settingsSchema, 'floatingToggleEnabled: true,')
    );
    check(
        results,
        'settingsSchema',
        '默认禁用顶部通知气泡，避免更新弹窗遮挡手机视图',
        has(contents.settingsSchema, 'notificationBubblesEnabled: false,')
    );
    check(
        results,
        'settingsSchema',
        '悬浮按钮显示开关继续走 boolean 校验',
        has(contents.settingsSchema, "floatingToggleEnabled: { type: 'boolean' }")
    );
    check(
        results,
        'settingsSchema',
        '通知气泡开关继续走 boolean 校验',
        has(contents.settingsSchema, "notificationBubblesEnabled: { type: 'boolean' }")
    );

    check(
        results,
        'settingsPanel',
        '扩展设置页继续声明悬浮窗开关 checkbox id',
        has(contents.settingsPanel, "const FLOATING_TOGGLE_CHECKBOX_ID = 'yuzi-phone-floating-toggle-enabled';")
    );
    check(
        results,
        'settingsPanel',
        '扩展设置页显示“悬浮窗开关”文案',
        has(contents.settingsPanel, '<span>悬浮窗开关</span>')
    );
    check(
        results,
        'settingsPanel',
        '悬浮窗开关默认按 floatingToggleEnabled !== false 兼容旧配置',
        has(contents.settingsPanel, 'const isFloatingToggleEnabled = settings.floatingToggleEnabled !== false;')
    );
    check(
        results,
        'settingsPanel',
        '悬浮窗开关保存到 floatingToggleEnabled 设置键',
        has(contents.settingsPanel, "savePhoneSetting('floatingToggleEnabled', checkbox.checked);")
    );
    check(
        results,
        'settingsPanel',
        '悬浮窗开关保存后触发现有按钮样式刷新事件',
        has(contents.settingsPanel, "window.dispatchEvent(new CustomEvent('yuzi-phone-toggle-style-updated'));")
    );

    check(
        results,
        'toggleButton',
        'toggle-button 暴露 applyPhoneToggleVisibility()',
        has(contents.toggleButton, 'export function applyPhoneToggleVisibility(')
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏会计算 shouldHide 状态',
        has(contents.toggleButton, 'const shouldHide = settings?.floatingToggleEnabled === false;')
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏保留 DOM 节点并设置 hidden 属性',
        has(contents.toggleButton, 'btn.hidden = shouldHide;')
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏使用 inline display 防止 CSS 覆盖 hidden',
        has(contents.toggleButton, "btn.style.display = shouldHide ? 'none' : '';")
    );
    check(
        results,
        'toggleButton',
        '悬浮按钮隐藏同步 aria-hidden 状态',
        has(contents.toggleButton, "btn.setAttribute('aria-hidden', shouldHide ? 'true' : 'false');")
    );
    check(
        results,
        'toggleButton',
        'syncPhoneToggleVisualStyle() 同步样式、位置后再应用可见性',
        has(contents.toggleButton, 'applyPhoneToggleVisualStyle(btn, settings);\n    applyPhoneTogglePosition(btn, { settings, persistIfAdjusted: true });\n    applyPhoneToggleVisibility(btn, settings);')
    );
    check(
        results,
        'toggleButton',
        'createPhoneToggleButton() 复用已绑定按钮时仍应用可见性',
        has(contents.toggleButton, 'if (btn && btn === boundToggleButton) {\n        const settings = getPhoneSettings();\n        applyPhoneToggleVisualStyle(btn, settings);\n        applyPhoneTogglePosition(btn, { settings, persistIfAdjusted: true });\n        applyPhoneToggleVisibility(btn, settings);')
    );
    check(
        results,
        'toggleButton',
        'createPhoneToggleButton() 首次创建后仍返回保留在 DOM 中的按钮',
        has(contents.toggleButton, 'root.appendChild(btn);')
            && has(contents.toggleButton, 'bindPhoneToggleDraggable(btn, onToggle);\n    return btn;')
    );

    const unreadUpdateIndex = indexOfOrMinusOne(
        contents.notifications,
        'state.unreadCounts[targetBadgeKey] = (state.unreadCounts[targetBadgeKey] || 0) + newCount;'
    );
    const notificationGateIndex = indexOfOrMinusOne(
        contents.notifications,
        'if (getPhoneSettings().notificationBubblesEnabled !== true) return;'
    );
    const containerLookupIndex = indexOfOrMinusOne(
        contents.notifications,
        "const container = document.getElementById('phone-notif-container');"
    );

    check(
        results,
        'notifications',
        '通知模块读取 phone settings 以控制顶部气泡',
        has(contents.notifications, "import { getPhoneSettings } from '../settings.js';")
    );
    check(
        results,
        'notifications',
        '顶部通知气泡默认禁用时不会创建 DOM 气泡',
        notificationGateIndex >= 0
    );
    check(
        results,
        'notifications',
        '禁用通知气泡前仍先更新 unreadCounts',
        unreadUpdateIndex >= 0 && notificationGateIndex > unreadUpdateIndex
    );
    check(
        results,
        'notifications',
        'DOM 容器缺失不会阻断 unreadCounts 更新',
        unreadUpdateIndex >= 0 && containerLookupIndex > unreadUpdateIndex
    );
    check(
        results,
        'notifications',
        '通知气泡启用后仍保留点击跳转和清 badge 行为',
        has(contents.notifications, 'clearUnreadBadge(targetBadgeKey);')
            && has(contents.notifications, 'navigateTo(targetRoute);')
    );

    const failed = results.filter((item) => !item.ok);
    if (failed.length > 0) {
        console.error('[low-risk-ui-settings-contract-check] 检查失败：');
        for (const item of failed) {
            console.error(`- ${item.file}: ${item.description}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('[low-risk-ui-settings-contract-check] 检查通过');
    for (const item of results) {
        console.log(`- OK | ${item.file} | ${item.description}`);
    }
}

main();
