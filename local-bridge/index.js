const JZZ = require('jzz');
const WebSocket = require('ws');

// Configuration
const EBS_URL = 'wss://abletonlivechat.flairtec.de';
const MIDI_PORT_SEARCH = 'loopMIDI Port';

console.log('--- Twitch Ableton Local Bridge (JZZ) ---');

// 1. Setup MIDI
let midiOutput = null;

// Initialize JZZ
JZZ().or(function () { console.log('Cannot start MIDI engine!'); })
    .and(function () {
        const info = this.info();
        console.log('Available MIDI Outputs:', info.outputs.map(x => x.name));

        let found = false;

        // Try to find the port by name
        // JZZ.openMidiOut name matching is strict, so we iterate to find a partial match or exact match
        const portName = info.outputs.find(x => x.name.includes(MIDI_PORT_SEARCH))?.name;

        if (portName) {
            console.log(`Found MIDI Port: ${portName}`);
            this.openMidiOut(portName).or(function () {
                console.log('Failed to open port.');
            }).and(function () {
                console.log(`Connected to MIDI Output: ${portName}`);
                midiOutput = this;
                found = true;
            });
        } else {
            console.log(`Port "${MIDI_PORT_SEARCH}" not found. Trying first available...`);
            if (info.outputs.length > 0) {
                this.openMidiOut(info.outputs[0].name).and(function () {
                    console.log(`Connected to: ${info.outputs[0].name}`);
                    midiOutput = this;
                    found = true;
                });
            }
        }
    });

// 2. Connect to EBS
function connectToEBS() {
    const ws = new WebSocket(EBS_URL);

    ws.on('open', () => {
        console.log('Connected to Extension Backend Service (EBS)');
        ws.send(JSON.stringify({ type: 'identify', role: 'bridge' }));
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
        console.log('Cannot send MIDI: Output not connected.');
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
            } else if (action === 'cc') {
                midiOutput.control(ch, controller || 1, value || 127);
            } else if (action === 'start') {
                // START MAPPING: Sends Note 126 on Channel 16 (index 15)
                console.log('Sending Transport Play Note (126)');
                midiOutput.noteOn(15, 126, 127);
            } else if (action === 'stop') {
                // STOP MAPPING: Sends Note 127 on Channel 16 (index 15)
                console.log('Sending Transport Stop Note (127)');
                midiOutput.noteOn(15, 127, 127);
            }
            // console.log(`Sent Command: ${action}`);
        } catch (e) {
            console.error('Error sending MIDI:', e);
        }
    }
}


connectToEBS();
