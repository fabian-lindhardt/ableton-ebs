require('dotenv').config();
const max = require('max-api');
const WebSocket = require('ws');

// Configuration
// Allow overriding via Max message or .env
let EBS_URL = process.env.EBS_URL || 'wss://abletonlivechat.flairtec.de';

let wsConnection = null;
const bridgeCache = new Map(); // Store last known values for sync
const syncThrottles = new Map(); // Key: "ch-ctrl", Value: { lastRun: 0, timeout: null }
const SYNC_RATE_LIMIT = 50; // 20Hz updates for smoothness without flooding

max.post(`--- Twitch Ableton Bridge (Node.js) ---`);
max.post(`EBS URL: ${EBS_URL}`);

// --- MAX HANDLERS ---

// Allow changing URL dynamically
max.addHandler('set_url', (url) => {
    if (url && typeof url === 'string') {
        EBS_URL = url;
        max.post(`EBS URL updated to: ${EBS_URL}`);
        connectToEBS(); // Reconnect
    }
});

// Explicit connect command
max.addHandler('connect', () => {
    connectToEBS();
});

// Handle Sync Data from Max (e.g., Fader moves in Ableton)
max.addHandler('sync', (channel, controller, value) => {
    const ch = parseInt(channel);
    const ctrl = parseInt(controller);
    const val = parseInt(value);

    // Update Local Cache
    const key = `${ch}-${ctrl}`;
    bridgeCache.set(key, val);

    broadcastSync(ch, ctrl, val);
});

// Handle Metadata from Max (Track names, etc.)
max.addHandler('metadata', (payload) => {
    if (!payload) return;

    let data = payload;
    if (typeof payload === 'string') {
        try {
            data = JSON.parse(payload);
        } catch (e) {
            max.post(`[Error] Invalid JSON metadata: ${e.message}`);
            return;
        }
    }

    sendToEBS({ type: 'metadata', data: data });
});

// --- WEBSOCKET LOGIC ---

function connectToEBS() {
    if (wsConnection) {
        if (wsConnection.readyState === WebSocket.OPEN || wsConnection.readyState === WebSocket.CONNECTING) {
            wsConnection.close();
        }
    }

    max.post(`Connecting to EBS at ${EBS_URL}...`);
    wsConnection = new WebSocket(EBS_URL);

    wsConnection.on('open', () => {
        max.post('Connected to Extension Backend Service (EBS)');
        max.outlet('status', 'connected');

        wsConnection.send(JSON.stringify({ type: 'identify', role: 'bridge' }));

        // Bulk Sync on Connect
        if (bridgeCache.size > 0) {
            max.post(`Sending Bulk Sync (${bridgeCache.size} items)...`);
            const bulkData = Object.fromEntries(bridgeCache);
            wsConnection.send(JSON.stringify({
                type: 'bulk_sync',
                data: bulkData
            }));
        }
    });

    wsConnection.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleCommand(msg);
        } catch (e) {
            max.post(`[Error] Parsing Message: ${e.message}`);
        }
    });

    wsConnection.on('close', () => {
        max.post('Disconnected from EBS. Reconnecting in 5s...');
        max.outlet('status', 'disconnected');
        setTimeout(connectToEBS, 5000);
    });

    wsConnection.on('error', (err) => {
        max.post(`WebSocket Error: ${err.message}`);
    });
}

function sendToEBS(payload) {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify(payload));
    }
}

function broadcastSync(channel, controller, value) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;

    const key = `${channel}-${controller}`;
    const now = Date.now();

    let state = syncThrottles.get(key);
    if (!state) {
        state = { lastRun: 0, timeout: null };
        syncThrottles.set(key, state);
    }

    if (state.timeout) {
        clearTimeout(state.timeout);
        state.timeout = null;
    }

    const timeSinceLast = now - state.lastRun;

    if (timeSinceLast >= SYNC_RATE_LIMIT) {
        sendSyncPayload(channel, controller, value);
        state.lastRun = now;
    } else {
        const delay = SYNC_RATE_LIMIT - timeSinceLast;
        state.timeout = setTimeout(() => {
            sendSyncPayload(channel, controller, value);
            state.lastRun = Date.now();
            state.timeout = null;
        }, delay);
    }
}

function sendSyncPayload(channel, controller, value) {
    sendToEBS({
        type: 'sync',
        data: { channel, controller, value }
    });
}

// --- COMMAND HANDLER ---

function handleCommand(cmd) {
    if (cmd.type === 'midi') {
        const { action, note, velocity, channel, controller, value } = cmd.data;
        const ch = (channel || 0) + 1; // Max uses 1-16

        if (action === 'noteon') {
            max.post(`MIDI: NoteOn Ch:${ch} Note:${note} Vel:${velocity}`);
            max.outlet('midi', 'noteon', ch, note, velocity);
        } else if (action === 'noteoff') {
            max.outlet('midi', 'noteoff', ch, note, velocity);
        } else if (action === 'cc' || action === 'fader' || action === 'knob') {
            const ctrl = parseInt(controller) || 1;
            const val = parseInt(value) || 0;
            max.post(`MIDI: CC Ch:${ch} Ctrl:${ctrl} Val:${val}`);
            max.outlet('midi', 'cc', ch, ctrl, val);
        }
    } else if (cmd.type === 'start' || cmd.type === 'ableton_play') {
        max.post("TRANSPORT: Play");
        max.outlet('transport', 'play');
    } else if (cmd.type === 'stop' || cmd.type === 'ableton_stop') {
        max.post("TRANSPORT: Stop");
        max.outlet('transport', 'stop');
    } else if (cmd.type === 'ableton_continue') {
        max.post("TRANSPORT: Continue");
        max.outlet('transport', 'continue');
    } else if (cmd.type === 'launch_clip') {
        const { trackIndex, clipIndex } = cmd.data;
        max.outlet('clip', 'launch', trackIndex, clipIndex);
    } else if (cmd.type === 'launch_scene') {
        const { sceneIndex } = cmd.data;
        max.outlet('scene', 'launch', sceneIndex);
    } else if (cmd.type === 'stop_track') {
        const { trackIndex } = cmd.data;
        max.outlet('track', 'stop', trackIndex);
    }
}

// Start connection immediately
connectToEBS();
