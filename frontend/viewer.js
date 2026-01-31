// Twitch Extension Helper
const twitch = window.Twitch.ext;
let authToken = 'dev-token'; // Default for local testing without Twitch Rig

// Listen for the onAuthorized event to get the JWT
if (twitch) {
    twitch.onAuthorized((auth) => {
        console.log('Twitch Authorized:', auth);
        authToken = auth.token;
        updateStatus('Connected to Twitch!');
    });
}

// Keep the localhost URL for now, but in production this should be relative or configured
const EBS_API = 'http://localhost:8080/api/trigger';
// In production (hosted on same server):
// const EBS_API = '/api/trigger';

async function sendCommand(type) {
    updateStatus('Sending...');
    try {
        const payload = {
            action: type,
            midi: { action: type } // 'start' or 'stop'
        };

        const res = await fetch(EBS_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            updateStatus('Sent!');
            setTimeout(() => updateStatus('Ready'), 2000);
        } else {
            updateStatus('Error: ' + data.message);
        }
    } catch (err) {
        console.error(err);
        updateStatus('Failed to connect to EBS');
    }
}

async function sendTrigger(name, amount) {
    // Simulate mapping "Clip 1" to a specific MIDI Note
    let midiData = {};
    if (name === 'clip1') {
        midiData = { action: 'noteon', note: 60, velocity: 100 }; // Middle C
    } else if (name === 'clip2') {
        midiData = { action: 'noteon', note: 62, velocity: 110 }; // D
    }

    updateStatus(`Simulating ${amount} Bits!`);

    try {
        // Bits would normally be handled via the Transaction Helper
        // twitch.bits.useBits(sku);
        // But for this custom trigger, we send it to our backend.

        const payload = {
            action: 'bits_trigger',
            midi: midiData
        };

        const res = await fetch(EBS_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });

    } catch (err) {
        console.error(err);
    }
}

function updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.innerText = msg;
}
