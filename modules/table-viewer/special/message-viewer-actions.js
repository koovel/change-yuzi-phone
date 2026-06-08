import { Logger } from '../../error-handler.js';
import {
    appendPhoneMessageRecordsBatch,
    buildPhoneMessagePayloadFromHeaders,
    callPhoneChatAI,
    getCurrentCharacterDisplayName,
    getCurrentPhoneAiInstructionPreset,
    getPhoneChatSettings,
    getPhoneChatWorldbookContext,
    getPhoneStoryContext,
    insertPhoneMessageRecord,
    updatePhoneMessageRecord,
} from '../../phone-core/chat-support.js';
import {
    buildPhoneChatConversationMessages,
    buildPhoneChatSystemMessages,
    createPhoneMessageRequestId,
    findConversationPartnerName,
    getConversationRows,
    materializeRowFromPayload,
    scrollMessageDetailToBottom,
} from './message-viewer-helpers.js';

const logger = Logger.withScope({ scope: 'table-viewer/message-actions', feature: 'table-viewer' });
const MAX_STRUCTURED_REPLY_MESSAGES = 4;
const LOCAL_TEMP_ROW_FLAG = '__yuziPhoneLocalTempMessage';
const LOCAL_TEMP_BATCH_KEY = '__yuziPhoneArchiveBatchId';
const LOCAL_TEMP_KIND_KEY = '__yuziPhoneArchiveKind';

const defaultMessageViewerActionDeps = {
    appendPhoneMessageRecordsBatch,
    buildPhoneMessagePayloadFromHeaders,
    insertPhoneMessageRecord,
    updatePhoneMessageRecord,
    callPhoneChatAI,
    getCurrentPhoneAiInstructionPreset,
    getCurrentCharacterDisplayName,
    getPhoneChatSettings,
    getPhoneChatWorldbookContext,
    getPhoneStoryContext,
    buildPhoneChatConversationMessages,
    buildPhoneChatSystemMessages,
    createPhoneMessageRequestId,
    findConversationPartnerName,
    getConversationRows,
    materializeRowFromPayload,
    scrollMessageDetailToBottom,
};

export function createMessageViewerActions(ctx = {}) {
    const {
        state,
        sheetKey,
        headers,
        container,
        readSpecialField,
        patchComposeUi,
        renderKeepScroll,
        syncRowsFromSheet,
        markLocalTableMutation,
        createDraftConversationId,
        viewerRuntime,
        actionDeps,
    } = ctx;

    const resolvedActionDeps = {
        ...defaultMessageViewerActionDeps,
        ...(actionDeps && typeof actionDeps === 'object' ? actionDeps : {}),
    };
    const {
        appendPhoneMessageRecordsBatch: appendPhoneMessageRecordsBatchImpl,
        buildPhoneMessagePayloadFromHeaders: buildPhoneMessagePayloadFromHeadersImpl,
        callPhoneChatAI: callPhoneChatAIImpl,
        getCurrentPhoneAiInstructionPreset: getCurrentPhoneAiInstructionPresetImpl,
        getCurrentCharacterDisplayName: getCurrentCharacterDisplayNameImpl,
        getPhoneChatSettings: getPhoneChatSettingsImpl,
        getPhoneChatWorldbookContext: getPhoneChatWorldbookContextImpl,
        getPhoneStoryContext: getPhoneStoryContextImpl,
        buildPhoneChatConversationMessages: buildPhoneChatConversationMessagesImpl,
        buildPhoneChatSystemMessages: buildPhoneChatSystemMessagesImpl,
        createPhoneMessageRequestId: createPhoneMessageRequestIdImpl,
        findConversationPartnerName: findConversationPartnerNameImpl,
        getConversationRows: getConversationRowsImpl,
        materializeRowFromPayload: materializeRowFromPayloadImpl,
        scrollMessageDetailToBottom: scrollMessageDetailToBottomImpl,
    } = resolvedActionDeps;

    if (!state || !Array.isArray(headers) || !(container instanceof HTMLElement) || typeof readSpecialField !== 'function') {
        return {
            handleSendMessage: async () => {},
            handleRetryMessage: async () => {},
            handleStopMessage: async () => {},
        };
    }

    const patchCompose = typeof patchComposeUi === 'function' ? patchComposeUi : () => {};
    const rerender = typeof renderKeepScroll === 'function' ? renderKeepScroll : () => {};
    const syncRows = typeof syncRowsFromSheet === 'function' ? syncRowsFromSheet : () => false;
    const markMutation = typeof markLocalTableMutation === 'function' ? markLocalTableMutation : () => {};
    const createDraftConversation = typeof createDraftConversationId === 'function'
        ? createDraftConversationId
        : () => `phone_thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const runtime = viewerRuntime && typeof viewerRuntime === 'object' ? viewerRuntime : null;

    const isViewerDisposed = () => {
        if (runtime && typeof runtime.isDisposed === 'function') {
            return runtime.isDisposed();
        }
        return false;
    };
    const isViewerActive = () => !isViewerDisposed();
    const runIfViewerActive = (callback, fallback) => {
        if (!isViewerActive() || typeof callback !== 'function') {
            return fallback;
        }
        return callback();
    };
    const patchComposeIfActive = () => runIfViewerActive(patchCompose);
    const scrollMessageDetailToBottomIfActive = () => runIfViewerActive(() => scrollMessageDetailToBottomImpl(container));
    const supportsAbortController = typeof AbortController === 'function';

    const normalizeComposeMediaDesc = (value) => {
        const normalized = String(value || '').trim();
        return normalized && normalized.toLowerCase() !== 'none' ? normalized : 'none';
    };

    const getComposeMediaForConversation = (conversationId) => {
        const safeConversationId = String(conversationId || '').trim();
        const mediaMap = state.composeMediaByConversation && typeof state.composeMediaByConversation === 'object'
            ? state.composeMediaByConversation
            : (state.composeMediaByConversation = {});
        const media = safeConversationId && mediaMap[safeConversationId] && typeof mediaMap[safeConversationId] === 'object'
            ? mediaMap[safeConversationId]
            : {};
        return {
            imageDesc: normalizeComposeMediaDesc(media.imageDesc),
            videoDesc: normalizeComposeMediaDesc(media.videoDesc),
        };
    };

    const clearComposeMediaForConversation = (conversationId) => {
        const safeConversationId = String(conversationId || '').trim();
        if (!safeConversationId || !state.composeMediaByConversation || typeof state.composeMediaByConversation !== 'object') return;
        delete state.composeMediaByConversation[safeConversationId];
    };

    const clearActiveSendRequest = (requestState = null) => {
        if (!state || typeof state !== 'object') return;
        if (!requestState || state.activeSendRequest === requestState) {
            state.activeSendRequest = null;
        }
        if (!state.activeSendRequest) {
            state.sendPhase = 'idle';
        }
    };

    const setSendPhase = (phase, requestState = null) => {
        const safePhase = String(phase || 'idle').trim() || 'idle';
        if (requestState && state.activeSendRequest !== requestState) return false;
        state.sendPhase = safePhase;
        if (requestState) {
            requestState.phase = safePhase;
        }
        return true;
    };

    const isCurrentSendRequest = (requestState) => !!requestState
        && state.activeSendRequest === requestState
        && !requestState.cancelled;

    const isCurrentAiSendRequest = (requestState) => isCurrentSendRequest(requestState)
        && String(requestState.phase || state.sendPhase || '').trim() === 'ai'
        && !requestState.abortController?.signal?.aborted;

    const shouldIgnoreSendResult = (requestState) => !isCurrentSendRequest(requestState);

    const abortRequest = (requestState, reason = '用户取消等待本次 AI 回复') => {
        if (!requestState || requestState.cancelled) return false;
        requestState.cancelled = true;
        if (requestState.abortController && !requestState.abortController.signal?.aborted) {
            try {
                requestState.abortController.abort(reason);
            } catch (error) {
                requestState.abortController.abort();
            }
        }
        return true;
    };

    const warnAction = (action, message, context = {}, error) => {
        logger.warn({
            action,
            message,
            context: {
                sheetKey,
                ...context,
            },
            error,
        });
    };

    const rerenderAndScrollToBottom = () => {
        if (!isViewerActive()) return;
        rerender();
        scrollMessageDetailToBottomImpl(container);
    };

    const rerenderPreservingLocalRows = () => {
        if (!isViewerActive()) return;
        if (state && typeof state === 'object') {
            state.skipSheetSyncOnce = true;
        }
        rerenderAndScrollToBottom();
    };

    const unwrapStructuredReplyField = (value = '') => {
        const safeValue = String(value ?? '').trim();
        const angleMatch = safeValue.match(/^<([\s\S]*)>$/);
        return angleMatch ? String(angleMatch[1] || '').trim() : safeValue;
    };

    const normalizeStructuredMediaValue = (value = '') => {
        const safeValue = unwrapStructuredReplyField(value);
        return safeValue && !/^(none|null|undefined)$/i.test(safeValue) ? safeValue : 'none';
    };

    const hasMeaningfulReplyMessage = (message = {}) => {
        const content = String(message.content || '').trim();
        const imageDesc = normalizeStructuredMediaValue(message.imageDesc);
        const videoDesc = normalizeStructuredMediaValue(message.videoDesc);
        return !!content || imageDesc !== 'none' || videoDesc !== 'none';
    };

    const parseStructuredReplyBlock = (blockText = '') => {
        const text = String(blockText || '').replace(/\r\n?/g, '\n').trim();
        if (!text) {
            return {
                matched: false,
                content: '',
                imageDesc: 'none',
                videoDesc: 'none',
            };
        }

        const structuredMatch = text.match(/^\s*正文[：:]\s*([\s\S]*?)^\s*图片描述[：:]\s*([\s\S]*?)^\s*视频描述[：:]\s*([\s\S]*?)\s*$/m);
        if (structuredMatch) {
            return {
                matched: true,
                content: unwrapStructuredReplyField(structuredMatch[1]),
                imageDesc: normalizeStructuredMediaValue(structuredMatch[2]),
                videoDesc: normalizeStructuredMediaValue(structuredMatch[3]),
            };
        }

        const lineByLineContent = [];
        let imageDesc = 'none';
        let videoDesc = 'none';
        let anyFieldMatched = false;

        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            const contentMatch = trimmed.match(/^正文[：:]\s*([\s\S]*)$/);
            if (contentMatch) {
                const val = unwrapStructuredReplyField(contentMatch[1]);
                if (val) lineByLineContent.push(val);
                anyFieldMatched = true;
                continue;
            }
            const imageMatch = trimmed.match(/^图片描述[：:]\s*([\s\S]*)$/);
            if (imageMatch) {
                imageDesc = normalizeStructuredMediaValue(imageMatch[1]);
                anyFieldMatched = true;
                continue;
            }
            const videoMatch = trimmed.match(/^视频描述[：:]\s*([\s\S]*)$/);
            if (videoMatch) {
                videoDesc = normalizeStructuredMediaValue(videoMatch[1]);
                anyFieldMatched = true;
                continue;
            }
            if (anyFieldMatched && lineByLineContent.length > 0) {
                lineByLineContent.push(line);
            }
        }

        if (anyFieldMatched) {
            return {
                matched: true,
                content: lineByLineContent.join('\n').trim(),
                imageDesc,
                videoDesc,
            };
        }

        return {
            matched: false,
            content: text,
            imageDesc: 'none',
            videoDesc: 'none',
        };
    };

    const parseStructuredAiReply = (rawText = '') => {
        const safeText = String(rawText || '').replace(/\r\n?/g, '\n').trim();
        if (!safeText) {
            return {
                matched: false,
                messages: [],
            };
        }

        const markerRegex = /^\s*消息\s*(\d+)\s*[：:]\s*$/gm;
        const markers = [];
        let markerMatch = markerRegex.exec(safeText);
        while (markerMatch) {
            markers.push({
                index: markerMatch.index,
                end: markerRegex.lastIndex,
                order: Number(markerMatch[1]),
            });
            markerMatch = markerRegex.exec(safeText);
        }

        if (markers.length > 0) {
            const messages = markers
                .slice(0, MAX_STRUCTURED_REPLY_MESSAGES)
                .map((marker, index) => {
                    const nextMarker = markers[index + 1];
                    const blockText = safeText.slice(marker.end, nextMarker ? nextMarker.index : safeText.length);
                    return parseStructuredReplyBlock(blockText);
                })
                .filter(hasMeaningfulReplyMessage)
                .map((message) => ({
                    content: String(message.content || '').trim(),
                    imageDesc: normalizeStructuredMediaValue(message.imageDesc),
                    videoDesc: normalizeStructuredMediaValue(message.videoDesc),
                }));

            return {
                matched: true,
                messages,
            };
        }

        const legacyMessage = parseStructuredReplyBlock(safeText);
        const normalizedLegacyMessage = {
            content: String(legacyMessage.content || '').trim(),
            imageDesc: normalizeStructuredMediaValue(legacyMessage.imageDesc),
            videoDesc: normalizeStructuredMediaValue(legacyMessage.videoDesc),
        };

        return {
            matched: legacyMessage.matched,
            messages: hasMeaningfulReplyMessage(normalizedLegacyMessage) ? [normalizedLegacyMessage] : [],
        };
    };

    const buildPromptOnlyRow = (payload = null) => {
        if (!payload || typeof payload !== 'object') return null;
        const rowPayload = typeof buildPhoneMessagePayloadFromHeadersImpl === 'function'
            ? buildPhoneMessagePayloadFromHeadersImpl(headers, payload)
            : payload;
        return materializeRowFromPayloadImpl(headers, rowPayload);
    };

    const hasPromptRecordInRows = (rows = [], pendingRecord = null) => {
        const pendingRequestId = String(pendingRecord?.requestId || '').trim();
        if (!pendingRequestId || !Array.isArray(rows)) return false;
        return rows.some((row) => String(readSpecialField(row, 'requestId') || '').trim() === pendingRequestId);
    };

    const buildAiRuntime = async (conversationId, threadTitle, options = {}) => {
        const phoneChatSettings = getPhoneChatSettingsImpl();
        const instructionPreset = getCurrentPhoneAiInstructionPresetImpl();
        const storyContext = phoneChatSettings.useStoryContext
            ? await getPhoneStoryContextImpl(phoneChatSettings.storyContextTurns)
            : '';
        const worldbookContext = await getPhoneChatWorldbookContextImpl(phoneChatSettings);
        const threadRows = getConversationRowsImpl(state.rowsData, conversationId, readSpecialField);
        const shouldAppendPromptOnlyUserRow = !hasPromptRecordInRows(threadRows, options?.pendingUserRecord);
        const promptOnlyUserRow = shouldAppendPromptOnlyUserRow
            ? buildPromptOnlyRow(options?.pendingUserRecord)
            : null;
        const threadRowsForPrompt = promptOnlyUserRow
            ? [...threadRows, promptOnlyUserRow]
            : threadRows;
        const partnerName = state.selectedTarget
            || findConversationPartnerNameImpl(
                threadRows,
                readSpecialField,
                getCurrentCharacterDisplayNameImpl(threadTitle || '对方')
            );
        const targetCharacterName = String(state.selectedTarget || partnerName || '').trim();
        const aiMessages = [
            ...buildPhoneChatSystemMessagesImpl({
                instructionPreset,
                worldbookText: worldbookContext.text,
                storyContext,
                conversationTitle: threadTitle,
                targetCharacterName,
            }),
            ...buildPhoneChatConversationMessagesImpl(threadRowsForPrompt, readSpecialField, {
                instructionPreset,
                maxHistoryMessages: phoneChatSettings.maxHistoryMessages,
            }),
        ];

        return {
            phoneChatSettings,
            partnerName,
            targetCharacterName,
            aiMessages,
        };
    };

    const markLocalTempRow = (row, batchId, kind) => {
        if (!Array.isArray(row)) return row;
        Object.defineProperties(row, {
            [LOCAL_TEMP_ROW_FLAG]: { value: true, configurable: true },
            [LOCAL_TEMP_BATCH_KEY]: { value: batchId, configurable: true },
            [LOCAL_TEMP_KIND_KEY]: { value: kind, configurable: true },
        });
        return row;
    };

    const createLocalTempRow = (payload, batchId, kind) => {
        const rowPayload = typeof buildPhoneMessagePayloadFromHeadersImpl === 'function'
            ? buildPhoneMessagePayloadFromHeadersImpl(headers, payload)
            : payload;
        const row = materializeRowFromPayloadImpl(headers, rowPayload);
        return markLocalTempRow(row, batchId, kind);
    };

    const removeLocalTempRows = (batchId) => {
        const safeBatchId = String(batchId || '').trim();
        if (!safeBatchId || !Array.isArray(state.rowsData)) return false;
        const beforeLength = state.rowsData.length;
        state.rowsData = state.rowsData.filter((row) => !(row && row[LOCAL_TEMP_BATCH_KEY] === safeBatchId));
        return state.rowsData.length !== beforeLength;
    };

    const hasLocalTempRecord = (batchId, record, kind) => {
        const safeBatchId = String(batchId || '').trim();
        const safeRequestId = String(record?.requestId || '').trim();
        const safeKind = String(kind || '').trim();
        if (!safeBatchId || !safeRequestId || !safeKind || !Array.isArray(state.rowsData)) return false;
        return state.rowsData.some((row) => row
            && row[LOCAL_TEMP_BATCH_KEY] === safeBatchId
            && row[LOCAL_TEMP_KIND_KEY] === safeKind
            && String(readSpecialField(row, 'requestId') || '').trim() === safeRequestId);
    };

    const appendLocalTempRows = (records = [], batchId = '') => {
        if (!Array.isArray(records) || records.length === 0) return [];
        const rows = records.map((record, index) => createLocalTempRow(record, batchId, index === 0 ? 'user' : 'assistant'));
        state.rowsData.push(...rows);
        return rows;
    };

    const ensureLocalTempRowsVisible = (archiveState) => {
        const safeBatchId = String(archiveState?.batchId || '').trim();
        const records = Array.isArray(archiveState?.records) ? archiveState.records : [];
        if (!safeBatchId || records.length === 0) return [];

        const missingRecords = records
            .map((record, index) => ({ record, kind: index === 0 ? 'user' : 'assistant' }))
            .filter(({ record, kind }) => !hasLocalTempRecord(safeBatchId, record, kind));
        if (missingRecords.length === 0) return [];

        const rows = missingRecords.map(({ record, kind }) => createLocalTempRow(record, safeBatchId, kind));
        state.rowsData.push(...rows);
        return rows;
    };

    const clearPendingArchive = (batchId = '') => {
        const safeBatchId = String(batchId || state.pendingArchive?.batchId || '').trim();
        if (safeBatchId) {
            removeLocalTempRows(safeBatchId);
        }
        state.pendingArchive = null;
    };

    const finalizeArchiveSuccess = (archiveResult, batchId, successText, requestState = null) => {
        if (!isViewerActive()) return;
        if (requestState && shouldIgnoreSendResult(requestState)) return;
        if (requestState) {
            clearComposeMediaForConversation(requestState.conversationId);
        }
        state.pendingArchive = null;
        state.sending = false;
        state.errorText = '';
        state.statusText = archiveResult?.refreshed === false
            ? `${successText}，但投影刷新失败`
            : successText;
        clearActiveSendRequest(requestState);

        const synced = syncRows();
        if (!synced) {
            removeLocalTempRows(batchId);
            if (Array.isArray(archiveResult?.rows) && archiveResult.rows.length > 0) {
                state.rowsData.push(...archiveResult.rows.map((row) => (Array.isArray(row) ? [...row] : row)));
            }
        }
        rerenderAndScrollToBottom();
    };

    const failBeforeArchive = (batchId, conversationId, draftText, message, requestState = null) => {
        if (!isViewerActive()) return;
        if (requestState && shouldIgnoreSendResult(requestState)) return;
        removeLocalTempRows(batchId);
        state.pendingArchive = null;
        state.sending = false;
        state.draftByConversation[conversationId] = draftText;
        state.errorText = String(message || '角色回复失败');
        state.statusText = '';
        clearActiveSendRequest(requestState);
        rerenderPreservingLocalRows();
    };

    const cancelBeforeArchive = (requestState, message = '已取消等待，消息已放回输入框') => {
        if (!isViewerActive() || !requestState) return;
        removeLocalTempRows(requestState.batchId);
        state.pendingArchive = null;
        state.sending = false;
        state.draftByConversation[requestState.conversationId] = requestState.draftText;
        state.errorText = '';
        state.statusText = String(message || '已取消等待');
        clearActiveSendRequest(requestState);
        rerenderPreservingLocalRows();
    };

    const failArchive = (archiveState, message, requestState = null) => {
        if (!isViewerActive()) return;
        if (requestState && shouldIgnoreSendResult(requestState)) return;
        ensureLocalTempRowsVisible(archiveState);
        state.pendingArchive = {
            ...archiveState,
            status: 'failed',
            message: String(message || '归档失败'),
        };
        state.sending = false;
        state.errorText = String(message || '归档失败');
        state.statusText = '归档失败，可重新归档';
        clearActiveSendRequest(requestState);
        rerenderPreservingLocalRows();
    };

    const archiveRecords = async (archiveState) => {
        markMutation(1800);
        return await appendPhoneMessageRecordsBatchImpl(sheetKey, archiveState.records);
    };

    const handleStopMessage = async () => {
        if (!isViewerActive()) return;
        const requestState = state.activeSendRequest && typeof state.activeSendRequest === 'object'
            ? state.activeSendRequest
            : null;
        if (!isCurrentAiSendRequest(requestState)) return;

        abortRequest(requestState, '用户取消等待本次 AI 回复');
        cancelBeforeArchive(requestState, '已取消等待，消息已放回输入框');
    };

    const handleSendMessage = async ({ conversationId, threadTitle }) => {
        if (!isViewerActive()) return;
        if (state.sending) return;

        const activeConversationId = String(conversationId || '').trim() || createDraftConversation();
        const draftText = String(
            state.draftByConversation[activeConversationId]
            || state.draftByConversation[conversationId]
            || ''
        ).trim();
        if (!draftText) {
            state.errorText = '请输入消息内容';
            state.statusText = '';
            patchComposeIfActive();
            return;
        }

        clearPendingArchive();

        const requestId = createPhoneMessageRequestIdImpl();
        const composeMedia = getComposeMediaForConversation(activeConversationId);
        const batchId = `${requestId}_batch`;
        const abortController = supportsAbortController ? new AbortController() : null;
        const requestState = {
            requestId,
            batchId,
            conversationId: activeConversationId,
            draftText,
            phase: 'ai',
            cancelled: false,
            abortController,
        };
        const sentAt = new Date().toISOString();
        const userRecord = {
            threadId: activeConversationId,
            threadTitle,
            sender: '主角',
            senderRole: 'user',
            chatTarget: state.selectedTarget || '',
            content: draftText,
            sentAt,
            requestId,
            imageDesc: composeMedia.imageDesc,
            videoDesc: composeMedia.videoDesc,
        };

        state.activeSendRequest = requestState;
        state.sendPhase = 'ai';
        state.sending = true;
        state.errorText = '';
        state.statusText = '正在等待角色回复...';
        state.conversationId = activeConversationId;
        state.draftByConversation[activeConversationId] = '';
        state.pendingArchive = null;
        appendLocalTempRows([userRecord], batchId);
        rerenderPreservingLocalRows();

        let archiveState = null;

        try {
            const aiRuntime = await buildAiRuntime(activeConversationId, threadTitle, {
                pendingUserRecord: userRecord,
            });
            if (shouldIgnoreSendResult(requestState)) return;

            const { phoneChatSettings, partnerName, targetCharacterName, aiMessages } = aiRuntime;
            const aiResult = await callPhoneChatAIImpl(aiMessages, {
                apiPresetName: phoneChatSettings.apiPresetName,
                maxTokens: phoneChatSettings.maxReplyTokens,
                timeout: phoneChatSettings.requestTimeoutMs,
                signal: abortController?.signal,
            });
            if (shouldIgnoreSendResult(requestState)) return;

            if (!aiResult.ok) {
                if (aiResult.code === 'aborted') {
                    cancelBeforeArchive(requestState, '已取消等待，消息已放回输入框');
                    return;
                }
                failBeforeArchive(batchId, activeConversationId, draftText, aiResult.message || '角色回复失败', requestState);
                return;
            }

            const parsedAssistantReply = parseStructuredAiReply(aiResult.text);
            if (shouldIgnoreSendResult(requestState)) return;
            if (!Array.isArray(parsedAssistantReply.messages) || parsedAssistantReply.messages.length === 0) {
                failBeforeArchive(batchId, activeConversationId, draftText, '角色回复为空', requestState);
                return;
            }

            const assistantRecords = parsedAssistantReply.messages.slice(0, MAX_STRUCTURED_REPLY_MESSAGES).map((message, index) => ({
                threadId: activeConversationId,
                threadTitle,
                sender: partnerName,
                senderRole: 'assistant',
                chatTarget: targetCharacterName,
                content: message.content,
                sentAt: new Date(Date.now() + index + 1).toISOString(),
                requestId: `${requestId}_reply_${index + 1}`,
                replyToMessageId: requestId,
                imageDesc: message.imageDesc,
                videoDesc: message.videoDesc,
            }));

            archiveState = {
                status: 'pending',
                batchId,
                conversationId: activeConversationId,
                threadTitle,
                draftText,
                records: [userRecord, ...assistantRecords],
            };

            if (!isViewerActive()) {
                if (requestState.cancelled) return;
                const inactiveArchiveResult = await archiveRecords(archiveState);
                if (!inactiveArchiveResult?.ok) {
                    warnAction('send.archive.inactive_failed', '页面已离开时归档失败', {
                        activeConversationId,
                        requestId,
                        batchId,
                        failureMessage: inactiveArchiveResult?.message || '归档失败',
                    });
                }
                return;
            }

            if (shouldIgnoreSendResult(requestState)) return;
            setSendPhase('archive', requestState);
            state.statusText = '正在归档聊天记录...';
            patchComposeIfActive();
            state.pendingArchive = archiveState;

            const archiveResult = await archiveRecords(archiveState);
            if (shouldIgnoreSendResult(requestState)) return;
            if (!archiveResult?.ok) {
                failArchive(archiveState, archiveResult?.message || '归档失败', requestState);
                return;
            }

            finalizeArchiveSuccess(archiveResult, batchId, '发送成功', requestState);
        } catch (error) {
            if (shouldIgnoreSendResult(requestState)) return;
            warnAction('send.exception', '发送流程异常', {
                activeConversationId,
                requestId,
                archiveStarted: !!archiveState,
            }, error);
            if (archiveState) {
                failArchive(archiveState, error?.message || '归档过程中发生异常', requestState);
                return;
            }
            failBeforeArchive(batchId, activeConversationId, draftText, error?.message || '发送过程中发生异常', requestState);
        }
    };

    const handleRetryMessage = async ({ conversationId }) => {
        if (!isViewerActive()) return;
        if (state.sending) return;

        const pendingArchive = state.pendingArchive && typeof state.pendingArchive === 'object'
            ? state.pendingArchive
            : null;
        const activeConversationId = String(conversationId || '').trim();
        if (!pendingArchive || pendingArchive.status !== 'failed') {
            state.errorText = '当前没有可重新归档的消息';
            state.statusText = '';
            patchComposeIfActive();
            return;
        }
        if (activeConversationId && pendingArchive.conversationId !== activeConversationId) {
            state.errorText = '当前会话没有可重新归档的消息';
            state.statusText = '';
            patchComposeIfActive();
            return;
        }

        state.sending = true;
        state.sendPhase = 'archive';
        state.activeSendRequest = null;
        state.errorText = '';
        state.statusText = '正在重新归档...';
        patchComposeIfActive();
        scrollMessageDetailToBottomIfActive();

        try {
            const retryState = {
                ...pendingArchive,
                status: 'pending',
            };
            state.pendingArchive = retryState;
            const archiveResult = await archiveRecords(retryState);
            if (!archiveResult?.ok) {
                failArchive(retryState, archiveResult?.message || '重新归档失败');
                return;
            }
            finalizeArchiveSuccess(archiveResult, retryState.batchId, '重新归档成功');
            state.sendPhase = 'idle';
        } catch (error) {
            warnAction('archive.retry.exception', '重新归档流程异常', {
                conversationId: pendingArchive.conversationId,
                batchId: pendingArchive.batchId,
            }, error);
            failArchive(pendingArchive, error?.message || '重新归档过程中发生异常');
        }
    };

    return {
        handleSendMessage,
        handleRetryMessage,
        handleStopMessage,
    };
}
