require('dotenv').config();
const JZZ = require('jzz');
const WebSocket = require('ws');
const dgram = require('dgram');
const osc = require('osc');

// Configuration
const EBS_URL = process.env.EBS_URL || 'wss://abletonlivechat.flairtec.de';
const MIDI_PORT_SEARCH = 'loopMIDI Port';

console.log('--- Twitch Ableton Local Bridge (JZZ) ---');

// 1. Setup MIDI
let midiOutput = null;
const udpClient = dgram.createSocket('udp4');
const M4L_CMD_PORT = 9006;
const bridgeCache = new Map(); // Store last known values

// Initialize JZZ
// Initialize JZZ
JZZ().or(function () { console.log('Cannot start MIDI engine!'); })
    .and(function () {
        const info = this.info();
        console.log('Available MIDI Outputs:', info.outputs.map(x => x.name));
        console.log('Available MIDI Inputs:', info.inputs.map(x => x.name));

        let foundOut = false;
        let foundIn = false;

        // Try to find the port by name
        const portNameOut = info.outputs.find(x => x.name.includes(MIDI_PORT_SEARCH))?.name;
        const portNameIn = info.inputs.find(x => x.name.includes(MIDI_PORT_SEARCH))?.name;

        // --- OUTPUT ---
        if (portNameOut) {
            console.log(`Found MIDI Output Port: ${portNameOut}`);
            this.openMidiOut(portNameOut).or(function () {
                console.log('Failed to open Output port.');
            }).and(function () {
                console.log(`Connected to MIDI Output: ${portNameOut}`);
                midiOutput = this;
                foundOut = true;
            });
        } else {
            console.log(`Output Port "${MIDI_PORT_SEARCH}" not found. Trying first available...`);
            if (info.outputs.length > 0) {
                this.openMidiOut(info.outputs[0].name).and(function () {
                    console.log(`Connected to Output: ${info.outputs[0].name}`);
                    midiOutput = this;
                    foundOut = true;
                });
            }
        }

        // --- INPUT (For Sync) ---
        if (portNameIn) {
            console.log(`Found MIDI Input Port: ${portNameIn}`);
            this.openMidiIn(portNameIn).or(function () {
                console.log('Failed to open Input port.');
            }).and(function () {
                console.log(`Connected to MIDI Input: ${portNameIn}`);
                foundIn = true;

                // Listen for CC
                // Listen for CC
                this.connect(function (msg) {
                    try {
                        // Safe manual parsing
                        if (msg && msg.length >= 2) {
                            const status = msg[0];
                            // CC is range 0xB0 - 0xBF (176 - 191)
                            if (status >= 176 && status <= 191) {
                                const channel = status & 0x0F;
                                const controller = msg[1];
                                const value = msg[2] || 0;

                                console.log(`MIDI IN: Ch${channel} CC${controller} Val${value}`);

                                // Update Local Cache
                                const key = `${channel}-${controller}`;
                                bridgeCache.set(key, value);

                                broadcastSync(channel, controller, value);
                            }
                        }
                    } catch (e) {
                        console.error('MIDI Input Error:', e);
                    }
                });
            });
        } else {
            console.log(`Input Port "${MIDI_PORT_SEARCH}" not found. Sync unavailable.`);
        }

        // --- UDP LISTENER (For Metadata Sync from M4L) ---
        const udpServer = dgram.createSocket('udp4');
        udpServer.on('message', (msg, rinfo) => {
            try {
                let raw = msg.toString().trim();

                // Max sometimes prefixes with "payload " if it's sent as a message
                if (raw.startsWith('payload ')) {
                    raw = raw.substring(8);
                }

                // --- ROBUST JSON EXTRACTION ---
                // Find first '{' and last '}' to handle potential null-terminators or garbage
                const firstBrace = raw.indexOf('{');
                const lastBrace = raw.lastIndexOf('}');

                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    raw = raw.substring(firstBrace, lastBrace + 1);
                }

                const data = JSON.parse(raw);
                if (data.type === 'metadata') {
                    // Normalize data structure (handle both 'data' and 'payload' keys)
                    const payload = data.data || data.payload;
                    console.log(`[Metadata] Received from M4L:`, payload);
                    sendToEBS({ type: 'metadata', data: payload });
                }
            } catch (e) {
                console.warn('[Metadata] Received non-JSON or invalid UDP packet:', e.message);
                console.warn('Raw Content:', msg.toString().substring(0, 50) + '...');
            }
        });
        udpServer.bind(9005, () => {
            console.log('--- UDP Metadata Listener active on Port 9005 ---');
        });
    });

// Helper: Broadcast Sync to EBS
let wsConnection = null;
const syncThrottles = new Map(); // Key: "ch-ctrl", Value: { lastRun: 0, timeout: null }
const SYNC_RATE_LIMIT = 50; // Ultra-smooth 20Hz updates

function broadcastSync(channel, controller, value) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;

    const key = `${channel}-${controller}`;
    const now = Date.now();

    // Get or Init Throttle State
    let state = syncThrottles.get(key);
    if (!state) {
        state = { lastRun: 0, timeout: null };
        syncThrottles.set(key, state);
    }

    // Clear any pending trailing update
    if (state.timeout) {
        clearTimeout(state.timeout);
        state.timeout = null;
    }

    const timeSinceLast = now - state.lastRun;

    if (timeSinceLast >= SYNC_RATE_LIMIT) {
        // Send Immediately
        sendSyncPayload(channel, controller, value);
        state.lastRun = now;
    } else {
        // Schedule Trailing Update
        const delay = SYNC_RATE_LIMIT - timeSinceLast;
        state.timeout = setTimeout(() => {
            sendSyncPayload(channel, controller, value);
            state.lastRun = Date.now();
            state.timeout = null;
        }, delay);
    }
}

function sendSyncPayload(channel, controller, value) {
    console.log(`Broadcasting Sync: Ch${channel} CC${controller} Val${value}`);
    sendToEBS({
        type: 'sync',
        data: {
            channel,
            controller,
            value
        }
    });
}

function sendToEBS(payload) {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify(payload));
    }
}

// 2. Connect to EBS
// 2. Connect to EBS
function connectToEBS() {
    wsConnection = new WebSocket(EBS_URL);
    const ws = wsConnection;

    ws.on('open', () => {
        console.log('Connected to Extension Backend Service (EBS)');
        ws.send(JSON.stringify({ type: 'identify', role: 'bridge' }));

        // Send Cache (Bulk Sync) to EBS to restore state after deployment
        if (bridgeCache.size > 0) {
            console.log(`Sending Bulk Sync (${bridgeCache.size} items)...`);
            const bulkData = Object.fromEntries(bridgeCache);
            ws.send(JSON.stringify({
                type: 'bulk_sync',
                data: bulkData
            }));
        }
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            console.log('Received command:', msg);
            handleCommand(msg);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Disconnected from EBS. Reconnecting in 5s...');
        setTimeout(connectToEBS, 5000);
    });

    ws.on('error', (err) => {
        console.error('WebSocket Error:', err.message);
    });
}

// 3. Handle Commands
function handleCommand(cmd) {
    if (!midiOutput) {
        // console.log('Cannot send MIDI: Output not connected.');
        return;
    }

    if (cmd.type === 'midi') {
        const { action, note, velocity, channel, controller, value } = cmd.data;
        const ch = channel || 0;

        try {
            if (action === 'noteon') {
                midiOutput.noteOn(ch, note || 60, velocity || 127);
            } else if (action === 'noteoff') {
                midiOutput.noteOff(ch, note || 60, velocity || 0);
            } else if (action === 'cc' || action === 'fader' || action === 'knob') {
                // Ensure values are integers
                const ctrl = parseInt(controller) || 1;
                const val = parseInt(value) || 0;
                midiOutput.control(ch, ctrl, val);
            } else if (action === 'start') {
                midiOutput.noteOn(15, 126, 127);
                setTimeout(() => midiOutput.noteOff(15, 126, 0), 100);
            } else if (action === 'stop') {
                midiOutput.noteOn(15, 127, 127);
                setTimeout(() => midiOutput.noteOff(15, 127, 0), 100);
            } else if (action === 'restart') {
                midiOutput.noteOn(15, 125, 127);
                setTimeout(() => midiOutput.noteOff(15, 125, 0), 100);
            }
        } catch (e) {
            console.error('Error sending MIDI:', e);
        }
    } else if (cmd.type === 'launch_clip') {
        const { trackIndex, clipIndex } = cmd.data;
        const oscMsg = osc.writePacket({
            address: '/launch_clip',
            args: [
                { type: 'i', value: trackIndex },
                { type: 'i', value: clipIndex }
            ]
        });
        udpClient.send(Buffer.from(oscMsg), M4L_CMD_PORT, '127.0.0.1', () => {
            console.log(`[Bridge] OSC to M4L: /launch_clip ${trackIndex} ${clipIndex}`);
        });
    } else if (cmd.type === 'launch_scene') {
        const { sceneIndex } = cmd.data;
        const oscMsg = osc.writePacket({
            address: '/launch_scene',
            args: [
                { type: 'i', value: sceneIndex }
            ]
        });
        udpClient.send(Buffer.from(oscMsg), M4L_CMD_PORT, '127.0.0.1', () => {
            console.log(`[Bridge] OSC to M4L: /launch_scene ${sceneIndex}`);
        });
    }
}

connectToEBS();
