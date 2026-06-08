const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.cwd();
const LOCAL_TEMP_ROW_FLAG = '__yuziPhoneLocalTempMessage';
const LOCAL_TEMP_BATCH_KEY = '__yuziPhoneArchiveBatchId';
const LOCAL_TEMP_KIND_KEY = '__yuziPhoneArchiveKind';
const DEFAULT_HEADERS = [
    'row_id',
    '会话ID',
    '会话标题',
    '发送者',
    '发送者身份',
    '聊天对象',
    '消息内容',
    '消息发送时间',
    '图片描述',
    '视频描述',
    '请求ID',
    '回复到消息ID',
];

const MESSAGE_FIELD_CANDIDATES = Object.freeze({
    threadId: ['threadId', '会话ID', '会话Id', '会话编号', '对话ID'],
    threadTitle: ['threadTitle', '会话标题', '会话名称', '群聊标题', '标题'],
    sender: ['sender', '发送者', '发言者', '作者'],
    senderRole: ['senderRole', '发送者身份', '角色', '身份'],
    chatTarget: ['chatTarget', '聊天对象', '对话目标'],
    content: ['content', '消息内容', '三人消息内容', '文案', '正文'],
    sentAt: ['sentAt', '消息发送时间', '发送时间', '时间'],
    imageDesc: ['imageDesc', '图片描述'],
    videoDesc: ['videoDesc', '视频描述'],
    requestId: ['requestId', '请求ID', '请求Id', '请求编号'],
    replyToMessageId: ['replyToMessageId', '回复到消息ID', '回复消息ID', '回复到'],
});

class FakeHTMLElement {
    constructor(name = 'element') {
        this.name = name;
        this.nodes = new Map();
        this.scrollTop = 0;
        this.scrollHeight = 0;
        this.clientHeight = 0;
        this.isConnected = true;
    }

    setQuery(selector, node) {
        this.nodes.set(selector, node);
        return node;
    }

    querySelector(selector) {
        return this.nodes.get(selector) || null;
    }

    querySelectorAll() {
        return [];
    }
}

function installDomGlobals() {
    global.HTMLElement = FakeHTMLElement;
    global.requestAnimationFrame = (callback) => {
        if (typeof callback === 'function') {
            callback();
        }
        return 1;
    };
    global.cancelAnimationFrame = () => {};
    global.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    };
    global.window = global.window || {
        dispatchEvent() {},
        addEventListener() {},
        removeEventListener() {},
    };
}

function toModuleUrl(relativePath) {
    return pathToFileURL(path.join(ROOT, relativePath)).href;
}

function pickExistingHeader(headers, candidates = []) {
    const available = new Set((Array.isArray(headers) ? headers : []).map((header) => String(header || '').trim()).filter(Boolean));
    for (const candidate of candidates) {
        const key = String(candidate || '').trim();
        if (key && available.has(key)) {
            return key;
        }
    }
    return '';
}

function buildMessagePayloadForHeaders(headers, message = {}) {
    const payload = {};
    for (const [fieldKey, candidates] of Object.entries(MESSAGE_FIELD_CANDIDATES)) {
        const header = pickExistingHeader(headers, candidates);
        const value = message?.[fieldKey];
        if (!header || value === undefined) continue;
        payload[header] = value === null ? '' : String(value);
    }
    return payload;
}

function hasHeaderPayloadKey(headers, payload = {}) {
    if (!payload || typeof payload !== 'object') return false;
    return (Array.isArray(headers) ? headers : []).some((header) => {
        const key = String(header || '').trim();
        return key && Object.prototype.hasOwnProperty.call(payload, key);
    });
}

function resolvePayloadForHeaders(headers, payload = {}) {
    if (hasHeaderPayloadKey(headers, payload)) {
        return payload;
    }
    return buildMessagePayloadForHeaders(headers, payload);
}

function materializeRow(headers, payload = {}) {
    const headerList = Array.isArray(headers) ? headers : [];
    const resolvedPayload = resolvePayloadForHeaders(headerList, payload);
    return headerList.map((header) => {
        const key = String(header || '').trim();
        return Object.prototype.hasOwnProperty.call(resolvedPayload, key) ? resolvedPayload[key] : '';
    });
}

function createReadSpecialField(headers) {
    const headerList = Array.isArray(headers) ? headers : [];
    return (row, key, fallback = '') => {
        const safeKey = String(key || '').trim();
        const candidates = MESSAGE_FIELD_CANDIDATES[safeKey] || [safeKey];
        if (Array.isArray(row)) {
            for (const candidate of candidates) {
                const header = String(candidate || '').trim();
                const index = headerList.indexOf(header);
                if (index < 0 || row[index] === undefined || row[index] === null) continue;
                const value = String(row[index]).trim();
                if (value) return value;
            }
            return fallback;
        }
        if (row && typeof row === 'object') {
            for (const candidate of candidates) {
                const field = String(candidate || '').trim();
                if (field && Object.prototype.hasOwnProperty.call(row, field)) {
                    return row[field];
                }
            }
        }
        return fallback;
    };
}

function createContainer() {
    const container = new FakeHTMLElement('container');
    const body = new FakeHTMLElement('body');
    body.scrollHeight = 480;
    body.clientHeight = 160;
    body.scrollTop = 0;
    container.setQuery('.phone-app-body', body);
    return { container, body };
}

function clonePayload(payload) {
    return payload && typeof payload === 'object' ? { ...payload } : payload;
}

function cloneRow(row) {
    if (!Array.isArray(row)) return clonePayload(row);

    const cloned = [...row];
    for (const key of [LOCAL_TEMP_ROW_FLAG, LOCAL_TEMP_BATCH_KEY, LOCAL_TEMP_KIND_KEY]) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        Object.defineProperty(cloned, key, {
            value: row[key],
            configurable: true,
        });
    }
    return cloned;
}

function markTempRow(row, batchId, kind) {
    if (!Array.isArray(row)) return row;
    Object.defineProperties(row, {
        [LOCAL_TEMP_ROW_FLAG]: { value: true, configurable: true },
        [LOCAL_TEMP_BATCH_KEY]: { value: batchId, configurable: true },
        [LOCAL_TEMP_KIND_KEY]: { value: kind, configurable: true },
    });
    return row;
}

function makeTempRows(headers, records, batchId) {
    return records.map((record, index) => markTempRow(materializeRow(headers, record), batchId, index === 0 ? 'user' : 'assistant'));
}

function assertNoMessageStatus(messages) {
    for (const message of messages) {
        assert.equal(Object.prototype.hasOwnProperty.call(message, 'messageStatus'), false, '归档 payload 不应包含 messageStatus');
    }
}

function assertRowsArePersistent(rows) {
    for (const row of rows) {
        assert.equal(Boolean(row?.[LOCAL_TEMP_ROW_FLAG]), false, '归档成功后不应继续显示临时气泡');
    }
}

function assertRowsHaveNoLocalTemps(rows, message = '不应显示本地临时气泡') {
    for (const row of Array.isArray(rows) ? rows : []) {
        assert.equal(Boolean(row?.[LOCAL_TEMP_ROW_FLAG]), false, message);
    }
}

function assertOnlyUserTempRows(rows, expectedCount = 1, message = '应只显示用户临时气泡') {
    const safeRows = Array.isArray(rows) ? rows : [];
    assert.equal(safeRows.length, expectedCount, `${message}：临时行数量不符合预期`);
    for (const row of safeRows) {
        assert.equal(Boolean(row?.[LOCAL_TEMP_ROW_FLAG]), true, `${message}：应为本地临时行`);
        assert.equal(row?.[LOCAL_TEMP_KIND_KEY], 'user', `${message}：不应出现助手临时气泡`);
    }
}

function assertTempKindCounts(rows, expectedCounts, message = '临时气泡类型数量不符合预期') {
    const counts = { user: 0, assistant: 0 };
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row?.[LOCAL_TEMP_ROW_FLAG]) continue;
        const kind = String(row[LOCAL_TEMP_KIND_KEY] || '').trim();
        if (Object.prototype.hasOwnProperty.call(counts, kind)) counts[kind] += 1;
    }
    assert.equal(counts.user, expectedCounts.user || 0, `${message}：user 数量不符合预期`);
    assert.equal(counts.assistant, expectedCounts.assistant || 0, `${message}：assistant 数量不符合预期`);
}

function countPromptUserMessages(aiCall, content) {
    return (aiCall?.messages || []).filter((message) => message.role === 'user' && message.content === content).length;
}

function findSnapshot(harness, label) {
    return harness.snapshots.find((snapshot) => snapshot.label === label) || null;
}

function createArchiveRecords(conversationId = 'conv_retry', requestId = 'req_retry') {
    return [
        {
            threadId: conversationId,
            threadTitle: '重试会话',
            sender: '主角',
            senderRole: 'user',
            chatTarget: '测试对象',
            content: '需要重新归档的用户消息',
            sentAt: '2026-05-03T00:00:00.000Z',
            requestId,
            imageDesc: 'none',
            videoDesc: 'none',
        },
        {
            threadId: conversationId,
            threadTitle: '重试会话',
            sender: '测试角色',
            senderRole: 'assistant',
            chatTarget: '测试对象',
            content: '需要重新归档的角色回复',
            sentAt: '2026-05-03T00:00:01.000Z',
            requestId: `${requestId}_reply_1`,
            replyToMessageId: requestId,
            imageDesc: 'none',
            videoDesc: 'none',
        },
    ];
}

function createHarness(createMessageViewerActions, options = {}) {
    const headers = Array.isArray(options.headers) ? options.headers : DEFAULT_HEADERS;
    const logs = {
        patchCount: 0,
        rerenderCount: 0,
        syncRowsCount: 0,
        mutationCalls: [],
        archiveCalls: [],
        aiCalls: [],
        scrollCalls: 0,
    };

    const { container, body } = createContainer();
    const readSpecialField = createReadSpecialField(headers);
    const archiveQueue = Array.isArray(options.archiveResults) ? [...options.archiveResults] : [];
    let runtimeDisposed = Boolean(options.runtimeDisposed);
    let lastArchivedRows = null;
    const snapshots = [];
    const captureSnapshot = (label) => {
        snapshots.push({
            label,
            rowsData: Array.isArray(state.rowsData) ? state.rowsData.map(cloneRow) : [],
            pendingArchive: state.pendingArchive ? { ...state.pendingArchive } : null,
            statusText: String(state.statusText || ''),
            errorText: String(state.errorText || ''),
            sending: !!state.sending,
            sendPhase: String(state.sendPhase || ''),
            composeMediaByConversation: state.composeMediaByConversation ? JSON.parse(JSON.stringify(state.composeMediaByConversation)) : {},
        });
    };
    const disposeRuntime = () => {
        runtimeDisposed = true;
    };
    const viewerRuntime = options.viewerRuntime || {
        isDisposed: () => runtimeDisposed,
        dispose: disposeRuntime,
    };

    const state = {
        sending: false,
        draftByConversation: {},
        rowsData: [],
        selectedPromptTemplateName: '默认提示词',
        selectedTarget: '测试对象',
        errorText: '',
        statusText: '',
        conversationId: '',
        pendingArchive: null,
        skipSheetSyncOnce: false,
        composeMediaByConversation: {},
        ...(options.state || {}),
    };

    const buildArchiveSuccess = (messages, overrides = {}) => {
        const rows = Array.isArray(overrides.rows)
            ? overrides.rows.map(cloneRow)
            : messages.map((message) => materializeRow(headers, message));
        return {
            ok: true,
            payloads: messages.map(clonePayload),
            rows,
            rowIndexes: messages.map((_message, index) => index + 1),
            refreshed: true,
            ...overrides,
        };
    };

    const actionDeps = {
        getPhoneChatSettings: () => ({
            useStoryContext: false,
            storyContextTurns: 3,
            apiPresetName: 'preset-under-test',
            maxReplyTokens: 256,
            requestTimeoutMs: 30000,
            maxHistoryMessages: 12,
        }),
        getCurrentPhoneAiInstructionPreset: () => ({ name: '测试预设', promptGroup: [] }),
        getPhoneStoryContext: async () => 'STORY_CONTEXT',
        getPhoneChatWorldbookContext: async () => ({ text: 'WORLDBOOK_CONTEXT' }),
        getConversationRows: (rows, conversationId, fieldReader) => (Array.isArray(rows) ? rows : []).filter((row) => String(fieldReader(row, 'threadId', '') || '') === String(conversationId || '')),
        findConversationPartnerName: () => options.partnerName || '测试角色',
        getCurrentCharacterDisplayName: (fallback = '对方') => String(fallback || '对方'),
        buildPhoneChatSystemMessages: ({ worldbookText, storyContext, conversationTitle, targetCharacterName }) => ([
            {
                role: 'system',
                content: [worldbookText, storyContext, conversationTitle, targetCharacterName].filter(Boolean).join(' | '),
            },
        ]),
        buildPhoneChatConversationMessages: (threadRows, fieldReader) => (Array.isArray(threadRows) ? threadRows : []).map((row) => ({
            role: String(fieldReader(row, 'senderRole', '') || '').toLowerCase() === 'user' ? 'user' : 'assistant',
            content: String(fieldReader(row, 'content', '') || ''),
        })),
        createPhoneMessageRequestId: () => options.requestId || 'req_test_1',
        buildPhoneMessagePayloadFromHeaders: buildMessagePayloadForHeaders,
        materializeRowFromPayload: (_headers, payload) => materializeRow(headers, payload),
        scrollMessageDetailToBottom: (el) => {
            logs.scrollCalls += 1;
            const targetBody = el.querySelector('.phone-app-body');
            if (targetBody) {
                targetBody.scrollTop = targetBody.scrollHeight;
            }
        },
        callPhoneChatAI: async (messages, requestOptions) => {
            logs.aiCalls.push({ messages, requestOptions });
            captureSnapshot('before-ai-result');
            if (typeof options.onAiCall === 'function') {
                return await options.onAiCall({ messages, requestOptions, logs, disposeRuntime, captureSnapshot });
            }
            if (options.aiError) {
                throw options.aiError;
            }
            return options.aiResult || {
                ok: true,
                text: '消息1：\n正文：AI 回复内容\n图片描述：none\n视频描述：none',
            };
        },
        appendPhoneMessageRecordsBatch: async (sheetKey, messages) => {
            const archivedMessages = Array.isArray(messages) ? messages.map(clonePayload) : [];
            logs.archiveCalls.push({ sheetKey, messages: archivedMessages });
            captureSnapshot('before-archive-result');
            if (typeof options.onArchiveCall === 'function') {
                const customResult = await options.onArchiveCall({
                    sheetKey,
                    messages: archivedMessages,
                    logs,
                    disposeRuntime,
                    buildArchiveSuccess,
                });
                if (customResult !== undefined) {
                    if (customResult?.ok && Array.isArray(customResult.rows)) {
                        lastArchivedRows = customResult.rows.map(cloneRow);
                    }
                    return customResult;
                }
            }
            if (options.archiveError) {
                throw options.archiveError;
            }
            const queued = archiveQueue.length > 0 ? archiveQueue.shift() : null;
            if (queued && queued.ok === false) {
                return queued;
            }
            const archiveResult = buildArchiveSuccess(archivedMessages, queued && typeof queued === 'object' ? queued : {});
            lastArchivedRows = Array.isArray(archiveResult.rows) ? archiveResult.rows.map(cloneRow) : null;
            return archiveResult;
        },
        ...(options.actionDeps || {}),
    };

    const actions = createMessageViewerActions({
        state,
        sheetKey: options.sheetKey || 'sheet_message_test',
        headers,
        container,
        readSpecialField,
        patchComposeUi: () => {
            logs.patchCount += 1;
        },
        renderKeepScroll: () => {
            logs.rerenderCount += 1;
        },
        syncRowsFromSheet: () => {
            logs.syncRowsCount += 1;
            const syncResult = options.syncRowsResult !== undefined ? options.syncRowsResult : true;
            if (syncResult && Array.isArray(lastArchivedRows)) {
                state.rowsData = lastArchivedRows.map(cloneRow);
            }
            return syncResult;
        },
        markLocalTableMutation: (delay) => {
            logs.mutationCalls.push(delay === undefined ? null : delay);
        },
        createDraftConversationId: () => options.generatedConversationId || 'generated_thread',
        viewerRuntime,
        actionDeps,
    });

    return {
        state,
        logs,
        snapshots,
        actions,
        container,
        body,
        headers,
        readSpecialField,
        viewerRuntime,
        disposeRuntime,
        captureSnapshot,
    };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function testBuildConversationsIgnoresDynamicNowFallback(buildConversations) {
    const readSpecialField = (row, key, fallback = '') => {
        if (key === 'sentAt' && row?.dynamicNowFallback) {
            return '2999-01-01T00:00:00.000Z';
        }
        return row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : fallback;
    };
    readSpecialField.readStaticField = (row, key, fallback = '') => {
        if (key === 'sentAt' && row?.dynamicNowFallback) return '';
        return readSpecialField(row, key, fallback);
    };

    const rows = [
        { threadId: 'conv_a', sender: '角色A', content: 'A 旧消息', sentAt: '2026-05-01T00:00:00.000Z', threadTitle: 'A' },
        { threadId: 'conv_b', sender: '角色B', content: 'B 最新消息', sentAt: '2026-05-03T00:00:00.000Z', threadTitle: 'B' },
        { threadId: 'conv_a', sender: '角色A', content: 'A 真实最新消息', sentAt: '2026-05-02T00:00:00.000Z', threadTitle: 'A' },
        { threadId: 'conv_a', sender: '角色A', content: 'A 动态 now 伪最新消息', dynamicNowFallback: true, threadTitle: 'A' },
    ];

    const desc = buildConversations(rows, readSpecialField, { feedOrder: 'desc' });
    assert.equal(desc[0].id, 'conv_b');
    assert.equal(desc[1].id, 'conv_a');
    assert.equal(desc[1].lastMessage, 'A 真实最新消息');
    assert.equal(desc[1].lastTime, '2026-05-02T00:00:00.000Z');

    const asc = buildConversations(rows, readSpecialField, { feedOrder: 'asc' });
    assert.equal(asc[0].id, 'conv_a');
    assert.equal(asc[0].lastMessage, 'A 真实最新消息');
}

async function testBuildConversationsUsesRowIndexTieBreak(buildConversations) {
    const readSpecialField = createReadSpecialField(DEFAULT_HEADERS);
    const rows = [
        materializeRow(DEFAULT_HEADERS, { threadId: 'conv_tie', sender: '甲', content: '第一条', sentAt: '2026-05-01T00:00:00.000Z' }),
        materializeRow(DEFAULT_HEADERS, { threadId: 'conv_tie', sender: '甲', content: '第二条', sentAt: '2026-05-01T00:00:00.000Z' }),
        materializeRow(DEFAULT_HEADERS, { threadId: 'conv_missing', sender: '乙', content: '缺时间靠行号兜底' }),
    ];
    const conversations = buildConversations(rows, readSpecialField, { feedOrder: 'desc' });
    const tieConversation = conversations.find((conversation) => conversation.id === 'conv_tie');
    assert.equal(tieConversation?.lastMessage, '第二条');
    assert.equal(conversations[0].id, 'conv_tie');
}

async function testRenderOneMessageRowNormalizesContentAndSenderRole(renderOneMessageRow) {
    const html = renderOneMessageRow({
        row: { sender: '不叫我', senderRole: 'user', content: { text: '对象内容不得泄漏' }, imageDesc: '<img src=x onerror=alert(1)>', videoDesc: 'none' },
        sourceRowIndex: 0,
        readSpecialField: (row, key, fallback = '') => (row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : fallback),
        styleOptions: { emptyMessageText: '（空消息）' },
    });
    assert.ok(html.includes('phone-special-message-item self'), 'senderRole=user 应渲染为 self 气泡');
    assert.ok(html.includes('（空消息）'), '对象 content 应回退为空消息文本');
    assert.equal(html.includes('[object Object]'), false, '对象 content 不得泄漏为 [object Object]');
    assert.ok(html.includes('data-action="open-media-preview"'), '有效图片描述应保留媒体预览按钮');
    assert.equal(html.includes('<img src=x'), false, '媒体描述进入属性前必须转义');
}

async function testRejectsEmptyDraft(createMessageViewerActions) {
    const harness = createHarness(createMessageViewerActions, {
        state: {
            draftByConversation: {
                conv_empty: '   ',
            },
        },
    });

    await harness.actions.handleSendMessage({ conversationId: 'conv_empty', threadTitle: '空草稿会话' });

    assert.equal(harness.state.errorText, '请输入消息内容');
    assert.equal(harness.state.statusText, '');
    assert.equal(harness.logs.patchCount, 1);
    assert.equal(harness.logs.archiveCalls.length, 0);
    assert.equal(harness.logs.aiCalls.length, 0);
}

async function testSendSuccessArchivesOnce(createMessageViewerActions) {
    const harness = createHarness(createMessageViewerActions, {
        state: {
            draftByConversation: {
                conv_success: '你好，世界',
            },
            composeMediaByConversation: {
                conv_success: {
                    imageDesc: ' 一张发送前图片 ',
                    videoDesc: '一段发送前视频',
                },
                conv_other: { imageDesc: '其他会话图片' },
            },
        },
        aiResult: {
            ok: true,
            text: '消息1：\n正文：第一条回复\n图片描述：none\n视频描述：none\n消息2：\n正文：第二条回复\n图片描述：一张猫图\n视频描述：none',
        },
    });

    await harness.actions.handleSendMessage({ conversationId: 'conv_success', threadTitle: '成功会话' });

    const beforeAiResult = findSnapshot(harness, 'before-ai-result');
    const beforeArchiveResult = findSnapshot(harness, 'before-archive-result');
    assert.ok(beforeAiResult, '发送等待 AI 阶段应产生快照');
    assert.ok(beforeArchiveResult, '归档前应产生快照');
    assertOnlyUserTempRows(beforeAiResult.rowsData, 1, '等待 AI 阶段应显示用户临时气泡');
    assertOnlyUserTempRows(beforeArchiveResult.rowsData, 1, 'AI 返回后归档前仍只应显示用户临时气泡');

    assert.equal(harness.state.sending, false);
    assert.equal(harness.state.errorText, '');
    assert.equal(harness.state.statusText, '发送成功');
    assert.equal(harness.state.draftByConversation.conv_success, '');
    assert.equal(harness.logs.archiveCalls.length, 1);
    assert.equal(harness.logs.archiveCalls[0].messages.length, 3);
    assertNoMessageStatus(harness.logs.archiveCalls[0].messages);
    assert.equal(harness.logs.archiveCalls[0].messages[0].content, '你好，世界');
    assert.equal(harness.logs.archiveCalls[0].messages[0].requestId, 'req_test_1');
    assert.equal(harness.logs.archiveCalls[0].messages[0].imageDesc, '一张发送前图片');
    assert.equal(harness.logs.archiveCalls[0].messages[0].videoDesc, '一段发送前视频');
    assert.equal(harness.logs.archiveCalls[0].messages[1].content, '第一条回复');
    assert.equal(harness.logs.archiveCalls[0].messages[1].requestId, 'req_test_1_reply_1');
    assert.equal(harness.logs.archiveCalls[0].messages[1].replyToMessageId, 'req_test_1');
    assert.equal(harness.logs.archiveCalls[0].messages[2].content, '第二条回复');
    assert.equal(harness.logs.archiveCalls[0].messages[2].imageDesc, '一张猫图');
    assert.equal(harness.logs.aiCalls.length, 1);
    assert.equal(countPromptUserMessages(harness.logs.aiCalls[0], '你好，世界'), 1, 'AI prompt 应且只应包含一次当前用户输入');
    assert.equal(harness.logs.syncRowsCount, 1);
    assertRowsArePersistent(harness.state.rowsData);
    assert.equal(harness.state.rowsData.length, 3);
    assert.equal(harness.body.scrollTop, harness.body.scrollHeight);
    assert.equal(Object.prototype.hasOwnProperty.call(harness.state.composeMediaByConversation, 'conv_success'), false, '发送归档成功后应只清当前会话附件');
    assert.deepEqual(harness.state.composeMediaByConversation.conv_other, { imageDesc: '其他会话图片' }, '发送成功不应清理其他会话附件');
}

async function testSendFailureRollback(createMessageViewerActions) {
    const harness = createHarness(createMessageViewerActions, {
        state: {
            draftByConversation: {
                conv_fail: '请回我',
            },
            composeMediaByConversation: {
                conv_fail: { imageDesc: '失败应保留图片', videoDesc: '失败应保留视频' },
                conv_other: { videoDesc: '其他会话视频' },
            },
        },
        aiResult: {
            ok: false,
            message: 'AI坏了',
        },
    });

    await harness.actions.handleSendMessage({ conversationId: 'conv_fail', threadTitle: '失败会话' });

    assert.equal(harness.state.sending, false);
    assert.equal(harness.state.errorText, 'AI坏了');
    assert.equal(harness.state.statusText, '');
    assert.equal(harness.state.draftByConversation.conv_fail, '请回我');
    assert.equal(harness.state.rowsData.length, 0);
    assertRowsHaveNoLocalTemps(harness.state.rowsData, 'AI 失败后不应遗留临时气泡');
    assert.equal(harness.logs.archiveCalls.length, 0);
    assert.equal(harness.logs.syncRowsCount, 0);
    assert.deepEqual(harness.state.composeMediaByConversation.conv_fail, { imageDesc: '失败应保留图片', videoDesc: '失败应保留视频' }, 'AI 失败不得清理当前会话附件');
    assert.deepEqual(harness.state.composeMediaByConversation.conv_other, { videoDesc: '其他会话视频' }, 'AI 失败不得清理其他会话附件');
}

async function testArchiveFailureAndRetry(createMessageViewerActions) {
    const harness = createHarness(createMessageViewerActions, {
        archiveResults: [
            { ok: false, message: 'DB坏了' },
            { ok: true },
        ],
        state: {
            draftByConversation: {
                conv_archive_fail: '先生成再归档',
            },
            composeMediaByConversation: {
                conv_archive_fail: { imageDesc: '归档失败图片', videoDesc: '归档失败视频' },
            },
        },
    });

    await harness.actions.handleSendMessage({ conversationId: 'conv_archive_fail', threadTitle: '归档失败会话' });

    const beforeArchiveResult = findSnapshot(harness, 'before-archive-result');
    assert.ok(beforeArchiveResult, '归档失败场景也应捕获归档前快照');
    assertOnlyUserTempRows(beforeArchiveResult.rowsData, 1, '归档失败前仍只应显示用户临时气泡');

    assert.equal(harness.state.sending, false);
    assert.equal(harness.state.errorText, 'DB坏了');
    assert.equal(harness.state.statusText, '归档失败，可重新归档');
    assert.equal(harness.state.pendingArchive?.status, 'failed');
    assert.equal(harness.state.pendingArchive?.conversationId, 'conv_archive_fail');
    assert.equal(harness.logs.archiveCalls.length, 1);
    assert.equal(harness.logs.aiCalls.length, 1);
    assert.equal(harness.state.rowsData.length, 2);
    assert.equal(harness.logs.archiveCalls[0].messages[0].imageDesc, '归档失败图片');
    assert.equal(harness.logs.archiveCalls[0].messages[0].videoDesc, '归档失败视频');
    assert.equal(harness.state.pendingArchive?.records?.[0]?.imageDesc, '归档失败图片');
    assert.deepEqual(harness.state.composeMediaByConversation.conv_archive_fail, { imageDesc: '归档失败图片', videoDesc: '归档失败视频' }, '归档失败必须保留当前会话附件以便用户修改后重新发送');
    assert.ok(harness.state.rowsData.every((row) => row?.[LOCAL_TEMP_ROW_FLAG] === true));
    assertTempKindCounts(harness.state.rowsData, { user: 1, assistant: 1 }, '归档失败后应补齐助手临时气泡且不重复用户气泡');

    await harness.actions.handleRetryMessage({ conversationId: 'conv_archive_fail' });

    assert.equal(harness.state.sending, false);
    assert.equal(harness.state.errorText, '');
    assert.equal(harness.state.statusText, '重新归档成功');
    assert.equal(harness.state.pendingArchive, null);
    assert.equal(harness.logs.archiveCalls.length, 2);
    assert.equal(harness.logs.aiCalls.length, 1, '重新归档不得重新调用 AI');
    assertNoMessageStatus(harness.logs.archiveCalls[1].messages);
    assert.equal(harness.logs.archiveCalls[1].messages[0].imageDesc, '归档失败图片');
    assert.equal(harness.logs.archiveCalls[1].messages[0].videoDesc, '归档失败视频');
    assertRowsArePersistent(harness.state.rowsData);
    assert.deepEqual(harness.state.composeMediaByConversation.conv_archive_fail, { imageDesc: '归档失败图片', videoDesc: '归档失败视频' }, '重新归档成功不得清理当前新草稿附件状态');
}

async function testRetryWithoutTarget(createMessageViewerActions) {
    const harness = createHarness(createMessageViewerActions, {
        state: {
            rowsData: [],
            pendingArchive: null,
        },
    });

    await harness.actions.handleRetryMessage({ conversationId: 'conv_retry_missing' });

    assert.equal(harness.state.errorText, '当前没有可重新归档的消息');
    assert.equal(harness.state.statusText, '');
    assert.equal(harness.logs.patchCount, 1);
    assert.equal(harness.logs.aiCalls.length, 0);
    assert.equal(harness.logs.archiveCalls.length, 0);
}

async function testRetryWrongConversation(createMessageViewerActions) {
    const records = createArchiveRecords('conv_retry_source', 'req_retry_source');
    const harness = createHarness(createMessageViewerActions, {
        state: {
            rowsData: makeTempRows(DEFAULT_HEADERS, records, 'req_retry_source_batch'),
            pendingArchive: {
                status: 'failed',
                batchId: 'req_retry_source_batch',
                conversationId: 'conv_retry_source',
                threadTitle: '重试会话',
                draftText: '需要重新归档的用户消息',
                records,
                message: '上次归档失败',
            },
        },
    });

    await harness.actions.handleRetryMessage({ conversationId: 'conv_other' });

    assert.equal(harness.state.errorText, '当前会话没有可重新归档的消息');
    assert.equal(harness.state.statusText, '');
    assert.equal(harness.logs.patchCount, 1);
    assert.equal(harness.logs.archiveCalls.length, 0);
    assert.equal(harness.logs.aiCalls.length, 0);
}

async function testSendSkipsUiAfterRuntimeDispose(createMessageViewerActions) {
    let resolveAi;
    const aiPending = new Promise((resolve) => {
        resolveAi = resolve;
    });
    const harness = createHarness(createMessageViewerActions, {
        state: {
            draftByConversation: {
                conv_dispose_send: '发送后切页',
            },
        },
        onAiCall: ({ disposeRuntime }) => {
            disposeRuntime();
            return aiPending;
        },
    });

    const sendPromise = harness.actions.handleSendMessage({ conversationId: 'conv_dispose_send', threadTitle: '发送切页会话' });
    await flushMicrotasks();
    resolveAi({
        ok: true,
        text: '消息1：\n正文：切页后的 AI 回复\n图片描述：none\n视频描述：none',
    });
    await sendPromise;

    assert.equal(harness.logs.aiCalls.length, 1);
    assert.equal(harness.logs.archiveCalls.length, 1);
    assert.equal(harness.logs.archiveCalls[0].messages.length, 2);
    assert.equal(harness.logs.syncRowsCount, 0);
    assert.equal(harness.state.statusText, '正在等待角色回复...');
    assert.equal(harness.state.sending, true);
    assert.equal(harness.state.pendingArchive, null);
    assertOnlyUserTempRows(harness.state.rowsData, 1, 'runtime disposed 后不应补写助手临时气泡');
}

async function testRetrySkipsUiAfterRuntimeDispose(createMessageViewerActions) {
    const records = createArchiveRecords('conv_retry_dispose', 'req_retry_dispose');
    let resolveArchive;
    const archivePending = new Promise((resolve) => {
        resolveArchive = resolve;
    });
    const harness = createHarness(createMessageViewerActions, {
        state: {
            rowsData: makeTempRows(DEFAULT_HEADERS, records, 'req_retry_dispose_batch'),
            pendingArchive: {
                status: 'failed',
                batchId: 'req_retry_dispose_batch',
                conversationId: 'conv_retry_dispose',
                threadTitle: '重试切页会话',
                draftText: '旧消息',
                records,
                message: '上次归档失败',
            },
        },
        onArchiveCall: ({ disposeRuntime }) => {
            disposeRuntime();
            return archivePending;
        },
    });

    const retryPromise = harness.actions.handleRetryMessage({ conversationId: 'conv_retry_dispose' });
    await flushMicrotasks();
    resolveArchive({
        ok: true,
        rows: records.map((record) => materializeRow(DEFAULT_HEADERS, record)),
        rowIndexes: [1, 2],
        refreshed: true,
    });
    await retryPromise;

    assert.equal(harness.logs.aiCalls.length, 0);
    assert.equal(harness.logs.archiveCalls.length, 1);
    assert.equal(harness.logs.syncRowsCount, 0);
    assert.equal(harness.state.statusText, '正在重新归档...');
    assert.equal(harness.state.sending, true);
    assert.equal(harness.state.pendingArchive?.status, 'pending');
    assert.ok(harness.state.rowsData.every((row) => row?.[LOCAL_TEMP_ROW_FLAG] === true));
}

async function main() {
    installDomGlobals();
    const { createMessageViewerActions } = await import(toModuleUrl('modules/table-viewer/special/message-viewer-actions.js'));
    const { buildConversations } = await import(toModuleUrl('modules/table-viewer/special/view-utils.js'));
    const { renderOneMessageRow } = await import(toModuleUrl('modules/table-viewer/special/message-viewer-helpers.js'));

    await testBuildConversationsIgnoresDynamicNowFallback(buildConversations);
    await testBuildConversationsUsesRowIndexTieBreak(buildConversations);
    await testRenderOneMessageRowNormalizesContentAndSenderRole(renderOneMessageRow);
    await testRejectsEmptyDraft(createMessageViewerActions);
    await testSendSuccessArchivesOnce(createMessageViewerActions);
    await testSendFailureRollback(createMessageViewerActions);
    await testArchiveFailureAndRetry(createMessageViewerActions);
    await testRetryWithoutTarget(createMessageViewerActions);
    await testRetryWrongConversation(createMessageViewerActions);
    await testSendSkipsUiAfterRuntimeDispose(createMessageViewerActions);
    await testRetrySkipsUiAfterRuntimeDispose(createMessageViewerActions);

    console.log('[message-viewer-behavior-check] 检查通过');
    console.log('- OK | 会话列表预览忽略 @now 动态 fallback 并保留真实最新消息');
    console.log('- OK | 会话列表相同 sentAt 使用 rowIndex 稳定兜底');
    console.log('- OK | 消息行渲染归一化非字符串 content 并兼容 senderRole self 判定');
    console.log('- OK | 空草稿发送被拒绝');
    console.log('- OK | 发送成功只触发一次批量归档且归档前仅显示用户临时气泡');
    console.log('- OK | AI 失败不显示临时气泡并恢复草稿');
    console.log('- OK | 归档失败才补显示当前页临时气泡，重新归档不重调 AI');
    console.log('- OK | 重新归档缺失目标和会话不匹配时命中兜底分支');
    console.log('- OK | 发送链路 runtime disposed 后只尝试归档，不继续写 UI state');
    console.log('- OK | 重新归档 runtime disposed 后跳过后续 UI 回写');
}

main().catch((error) => {
    console.error('[message-viewer-behavior-check] 检查失败：');
    console.error(error);
    process.exitCode = 1;
});
