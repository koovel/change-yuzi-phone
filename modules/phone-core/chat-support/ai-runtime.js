import { callApiWithTimeout, clampPositiveInteger, getDB, isDbBooleanSuccess } from '../db-bridge.js';

const PHONE_CHAT_AI_ABORT_CODE = 'aborted';

function sanitizePhoneChatMessages(messages) {
    return (Array.isArray(messages) ? messages : [])
        .map((message) => ({
            role: ['system', 'assistant', 'user'].includes(String(message?.role || '').trim())
                ? String(message.role).trim()
                : 'user',
            content: String(message?.content || '').trim(),
        }))
        .filter((message) => message.content);
}

function isAbortSignalLike(signal) {
    return !!signal
        && typeof signal === 'object'
        && typeof signal.aborted === 'boolean'
        && typeof signal.addEventListener === 'function'
        && typeof signal.removeEventListener === 'function';
}

function createAbortedPhoneChatAiResult(message = '已取消等待 AI 回复') {
    return {
        ok: false,
        code: PHONE_CHAT_AI_ABORT_CODE,
        message,
        text: '',
    };
}

function resolveAbortMessage(signal, fallback = '已取消等待 AI 回复') {
    const reason = signal?.reason;
    if (reason instanceof Error && reason.message) return reason.message;
    const reasonText = String(reason || '').trim();
    return reasonText || fallback;
}

function raceWithAbort(promise, signal) {
    if (!isAbortSignalLike(signal)) {
        return Promise.resolve(promise);
    }

    if (signal.aborted) {
        return Promise.resolve(createAbortedPhoneChatAiResult(resolveAbortMessage(signal)));
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
            resolve(value);
        };
        const handleAbort = () => {
            finish(createAbortedPhoneChatAiResult(resolveAbortMessage(signal)));
        };

        signal.addEventListener('abort', handleAbort, { once: true });
        Promise.resolve(promise).then(finish, (error) => {
            finish({
                ok: false,
                code: 'failed',
                message: error?.message || 'AI 调用失败',
                text: '',
            });
        });
    });
}

export async function callPhoneChatAI(messages, options = {}) {
    const signal = isAbortSignalLike(options.signal) ? options.signal : null;
    if (signal?.aborted) {
        return createAbortedPhoneChatAiResult(resolveAbortMessage(signal));
    }

    const api = getDB();
    if (!api || typeof api.callAI !== 'function') {
        return {
            ok: false,
            code: 'api_unavailable',
            message: '数据库 AI 接口不可用',
            text: '',
        };
    }

    const safeMessages = sanitizePhoneChatMessages(messages);
    if (safeMessages.length === 0) {
        return {
            ok: false,
            code: 'invalid_messages',
            message: '未提供有效的 AI 消息数组',
            text: '',
        };
    }

    const requestedPresetName = String(options.apiPresetName || '').trim();

    try {
        if (requestedPresetName) {
            if (typeof api.loadApiPreset !== 'function') {
                return {
                    ok: false,
                    code: 'preset_api_unavailable',
                    message: '数据库未暴露 loadApiPreset，无法应用聊天API预设',
                    text: '',
                };
            }

            const presetLoaded = isDbBooleanSuccess(api.loadApiPreset(requestedPresetName));
            if (!presetLoaded) {
                return {
                    ok: false,
                    code: 'preset_load_failed',
                    message: `聊天API预设加载失败：${requestedPresetName}`,
                    text: '',
                };
            }
        }

        if (signal?.aborted) {
            return createAbortedPhoneChatAiResult(resolveAbortMessage(signal));
        }

        const maxTokensRaw = Number(options.maxTokens ?? options.max_tokens);
        const maxTokens = Number.isFinite(maxTokensRaw)
            ? Math.max(64, Math.min(4096, Math.round(maxTokensRaw)))
            : 800;

        const textOrAbortResult = await raceWithAbort(
            callApiWithTimeout(
                () => api.callAI(safeMessages, { max_tokens: maxTokens }),
                Math.max(15000, clampPositiveInteger(options.timeout, 90000)),
                'callPhoneChatAI',
            ),
            signal,
        );

        if (textOrAbortResult && typeof textOrAbortResult === 'object' && textOrAbortResult.code === PHONE_CHAT_AI_ABORT_CODE) {
            return textOrAbortResult;
        }

        if (signal?.aborted) {
            return createAbortedPhoneChatAiResult(resolveAbortMessage(signal));
        }

        const safeText = String(textOrAbortResult || '').trim();
        if (!safeText) {
            return {
                ok: false,
                code: 'empty',
                message: 'AI 未返回有效内容',
                text: '',
            };
        }

        return {
            ok: true,
            code: 'ok',
            message: 'AI 调用成功',
            text: safeText,
        };
    } catch (error) {
        if (signal?.aborted) {
            return createAbortedPhoneChatAiResult(resolveAbortMessage(signal));
        }
        return {
            ok: false,
            code: 'failed',
            message: error?.message || 'AI 调用失败',
            text: '',
        };
    }
}
