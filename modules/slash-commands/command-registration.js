import { Logger } from '../error-handler.js';
import { createFallbackSlashCommands, handleListTablesCommand, handlePhoneCommand, handleSettingsCommand, handleTableCommand } from './command-actions.js';
import { clearFallbackSlashCommands, registerFallbackSlashCommands } from './host-adapter.js';
import { addRegisteredCommand, getRegisteredCommandsSnapshot } from './state.js';

const SLASH_COMMAND_DEFINITIONS = Object.freeze([
    {
        name: 'yuziphone',
        handler: handlePhoneCommand,
        description: 'koove手机控制命令：/yuziphone [open|close|toggle|reset|status|help]',
    },
    {
        name: 'yuziphone-open',
        handler: () => handlePhoneCommand('open'),
        description: '打开koove手机',
    },
    {
        name: 'yuziphone-close',
        handler: () => handlePhoneCommand('close'),
        description: '关闭koove手机',
    },
    {
        name: 'yuziphone-toggle',
        handler: () => handlePhoneCommand('toggle'),
        description: '切换koove手机状态',
    },
    {
        name: 'yuziphone-table',
        handler: handleTableCommand,
        description: '在手机中打开指定表格：/yuziphone-table <表名>',
    },
    {
        name: 'yuziphone-tables',
        handler: handleListTablesCommand,
        description: '列出所有可用表格',
    },
    {
        name: 'yuziphone-settings',
        handler: handleSettingsCommand,
        description: '手机设置命令：/yuziphone-settings [reset|export|import]',
    },
]);

function registerCommandDefinition(registerSlashCommand, definition) {
    registerSlashCommand(
        definition.name,
        definition.handler,
        definition.args ?? [],
        definition.description,
        definition.isVisible ?? true
    );
    addRegisteredCommand(definition.name);
}

export function registerSlashCommandDefinitions(registerSlashCommand) {
    SLASH_COMMAND_DEFINITIONS.forEach((definition) => {
        registerCommandDefinition(registerSlashCommand, definition);
    });
}

export function registerFallbackCommandSet() {
    const registered = registerFallbackSlashCommands(createFallbackSlashCommands());
    if (registered) {
        Logger.info('使用降级方案注册命令');
    }
    return registered;
}

export function unregisterSlashCommandDefinitions(unregisterSlashCommand) {
    if (typeof unregisterSlashCommand === 'function') {
        getRegisteredCommandsSnapshot().forEach((commandName) => {
            try {
                unregisterSlashCommand(commandName);
            } catch (error) {
                Logger.debug(`注销命令失败: ${commandName}`, error);
            }
        });
    }

    clearFallbackSlashCommands();
}
