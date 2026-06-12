'use strict';

const DEFAULT_REACTION_EMOJI = '❤️';

function normalizeWhatsAppJid(value) {
    return String(value || '')
        .trim()
        .replace(/:[0-9]+(?=@)/, '');
}

function pushUnique(list, value) {
    const normalized = normalizeWhatsAppJid(value);
    if (!normalized) return;
    if (!list.includes(normalized)) {
        list.push(normalized);
    }
}

function collectParticipantCandidates(msg, explicitCandidates = []) {
    const candidates = [];
    for (const candidate of explicitCandidates) {
        pushUnique(candidates, candidate);
    }

    pushUnique(candidates, msg?.participant);
    pushUnique(candidates, msg?.key?.participant);
    pushUnique(candidates, msg?.key?.remoteJid && msg?.key?.remoteJid !== 'status@broadcast' ? msg.key.remoteJid : '');

    const content = msg?.message || {};
    pushUnique(candidates, content?.reactionMessage?.key?.participant);
    pushUnique(candidates, content?.protocolMessage?.key?.participant);
    pushUnique(candidates, content?.extendedTextMessage?.contextInfo?.participant);
    pushUnique(candidates, content?.imageMessage?.contextInfo?.participant);
    pushUnique(candidates, content?.videoMessage?.contextInfo?.participant);

    return candidates;
}

function extractStatusMessageId(msg) {
    return (
        msg?.key?.id ||
        msg?.message?.reactionMessage?.key?.id ||
        msg?.message?.protocolMessage?.key?.id ||
        msg?.message?.extendedTextMessage?.contextInfo?.stanzaId ||
        msg?.message?.imageMessage?.contextInfo?.stanzaId ||
        msg?.message?.videoMessage?.contextInfo?.stanzaId ||
        ''
    );
}

function buildReactionKeys(messageId, participant) {
    if (!messageId || !participant) return [];

    return [
        {
            remoteJid: 'status@broadcast',
            id: messageId,
            participant,
            fromMe: false
        },
        {
            remoteJid: 'status@broadcast',
            id: messageId,
            participant,
            fromMe: false,
            statusJidList: [participant]
        },
        {
            id: messageId,
            remoteJid: 'status@broadcast',
            participant
        }
    ];
}

async function sendAttempt(sock, emoji, key, participant, delayFn, includeStatusList) {
    if (typeof delayFn === 'function') {
        await delayFn(120);
    }

    const options = includeStatusList ? { statusJidList: [participant] } : undefined;
    await sock.sendMessage(
        'status@broadcast',
        {
            react: {
                text: emoji,
                key
            }
        },
        options
    );
}

async function sendRobustStatusReaction({ sock, msg, emoji = DEFAULT_REACTION_EMOJI, candidates = [], delayFn } = {}) {
    if (!sock || !msg) {
        return false;
    }

    const messageId = extractStatusMessageId(msg);
    if (!messageId) {
        return false;
    }

    const participantCandidates = collectParticipantCandidates(msg, candidates);
    if (!participantCandidates.length) {
        return false;
    }

    let lastError = null;

    for (const participant of participantCandidates) {
        const keys = buildReactionKeys(messageId, participant);
        for (const key of keys) {
            try {
                await sendAttempt(sock, emoji || DEFAULT_REACTION_EMOJI, key, participant, delayFn, true);
                return true;
            } catch (error) {
                lastError = error;
            }

            try {
                await sendAttempt(sock, emoji || DEFAULT_REACTION_EMOJI, key, participant, delayFn, false);
                return true;
            } catch (error) {
                lastError = error;
            }
        }
    }

    if (lastError) {
        console.error('Status reaction helper warning:', lastError?.message || lastError);
    }

    return false;
}

module.exports = {
    sendRobustStatusReaction
};
