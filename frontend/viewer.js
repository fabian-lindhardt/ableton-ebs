// Twitch Extension Helper
const twitch = window.Twitch.ext;
let authToken = 'dev-token'; // Default for local testing without Twitch Rig

// Store Triggers
let activeTriggers = [];

// Add Static Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-start')?.addEventListener('click', () => sendCommand('start'));
    document.getElementById('btn-stop')?.addEventListener('click', () => sendCommand('stop'));
});

// Listen for Config Changes (Load Dynamic Buttons)
twitch.configuration.onChanged(() => {
    console.log('Config Changed Event');
    if (twitch.configuration.broadcaster) {
        try {
            const config = JSON.parse(twitch.configuration.broadcaster.content);
            if (config && config.triggers) {
                console.log('Loading Triggers:', config.triggers);
                activeTriggers = config.triggers;
                renderButtons();
            }
        } catch (e) {
            console.error('Invalid Config JSON');
        }
    } else {
        console.log('No configuration found');
        document.getElementById('dynamic-triggers').innerHTML = '<div class="empty-state">No triggers configured yet. Go to Extension Config!</div>';
    }
});

function renderButtons() {
    const container = document.getElementById('dynamic-triggers');
    if (!container) return; // Should be in panel.html

    container.innerHTML = ''; // Clear old buttons

    activeTriggers.forEach(trigger => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-trigger';
        btn.style.backgroundColor = trigger.color || '#9146FF';
        btn.style.marginBottom = '10px'; // Spacing

        // Inner Content
        btn.innerHTML = `
            <span class="label">${trigger.label}</span>
            ${trigger.cost > 0 ? `<span class="cost">💎 ${trigger.cost}</span>` : ''}
        `;

        // Click Handler (CSP Safe)
        btn.addEventListener('click', () => {
            if (trigger.cost > 0) {
                // Bits Logic would go here
                sendSmartTrigger(trigger);
            } else {
                sendSmartTrigger(trigger);
            }
        });

        container.appendChild(btn);
    });
}


// Keep the localhost URL for now, but in production this should be relative or configured
const EBS_API = 'https://abletonlivechat.flairtec.de/api/trigger';

async function sendCommand(type) {
    updateStatus('Transport: ' + type);

    // Reuse the smart trigger logic for simple start/stop
    // We treat 'start' and 'stop' as MIDI actions directly in the bridge
    const payload = {
        action: type,
        midi: { action: type }
    };

    await sendEBS(payload);
}

async function sendSmartTrigger(trigger) {
    updateStatus(`Sending: ${trigger.label}...`);

    const payload = {
        action: 'trigger',
        midi: {
            action: trigger.type,
            note: trigger.value,
            velocity: trigger.velocity,
            channel: 0,
            controller: trigger.controller,
            value: trigger.value
        }
    };

    await sendEBS(payload);
}

async function sendEBS(payload) {
    try {
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

function updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.innerText = msg;
}

// Listen for the onAuthorized event to get the JWT
if (twitch) {
    twitch.onAuthorized((auth) => {
        console.log('Twitch Authorized:', auth);
        authToken = auth.token;
        updateStatus('Connected to Twitch!');
    });
}
