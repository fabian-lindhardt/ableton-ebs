// Twitch Extension Helper
const twitch = window.Twitch.ext;

let currentConfig = {
    triggers: []
};

// Available MIDI Types
const MIDI_TYPES = ['noteon', 'noteoff', 'cc', 'start', 'stop'];

// On Init
twitch.configuration.onChanged(() => {
    console.log('Config loaded');
    if (twitch.configuration.broadcaster) {
        try {
            const config = JSON.parse(twitch.configuration.broadcaster.content);
            if (config && config.triggers) {
                currentConfig = config;
                renderTriggers();
            }
        } catch (e) {
            console.error('Invalid config JSON');
        }
    }
});

// Render the list of existing triggers
function renderTriggers() {
    const list = document.getElementById('trigger-list');
    list.innerHTML = '';

    currentConfig.triggers.forEach((trigger, index) => {
        const item = document.createElement('div');
        item.className = 'trigger-item';
        item.innerHTML = `
            <div class="trigger-info">
                <strong>${trigger.label}</strong> 
                <span class="badge">${trigger.type.toUpperCase()}</span>
                ${trigger.type === 'noteon' ? ` Note: ${trigger.value} Vel: ${trigger.velocity}` : ''}
                ${trigger.type === 'cc' ? ` CC: ${trigger.controller} Val: ${trigger.value}` : ''}
            </div>
            <button class="btn-delete" onclick="deleteTrigger(${index})">🗑️</button>
        `;
        list.appendChild(item);
    });
}

// Add a new trigger
function addTrigger() {
    const label = document.getElementById('new-label').value;
    const type = document.getElementById('new-type').value;
    const value = parseInt(document.getElementById('new-value').value) || 0;
    const velocity = parseInt(document.getElementById('new-velocity').value) || 127;
    const cost = parseInt(document.getElementById('new-cost').value) || 0;
    const color = document.getElementById('new-color').value;

    if (!label) return alert('Please enter a label');

    const newTrigger = {
        id: Date.now().toString(), // Simple unique ID
        label,
        type,
        color,
        cost
    };

    // Add specific MIDI data based on type
    if (type === 'noteon' || type === 'noteoff') {
        newTrigger.value = value; // Note number
        newTrigger.velocity = velocity;
    } else if (type === 'cc') {
        newTrigger.controller = value; // CC number
        newTrigger.value = velocity; // CC value (reusing velocity field for simplicity in UI)
    }
    // Start/Stop don't need values

    currentConfig.triggers.push(newTrigger);
    saveConfig();
    renderTriggers();

    // Reset form
    document.getElementById('new-label').value = '';
}

// Delete trigger
window.deleteTrigger = function (index) {
    currentConfig.triggers.splice(index, 1);
    saveConfig();
    renderTriggers();
};

// Save to Twitch Configuration Service
function saveConfig() {
    twitch.configuration.set(
        'broadcaster', // segment
        '1.0.0',       // version
        JSON.stringify(currentConfig) // content
    );
    console.log('Config saved:', currentConfig);
}

// UI Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-add').addEventListener('click', addTrigger);

    // Dynamic form fields based on type
    document.getElementById('new-type').addEventListener('change', (e) => {
        const type = e.target.value;
        const valInput = document.getElementById('new-value');
        const velInput = document.getElementById('new-velocity');

        if (type === 'start' || type === 'stop') {
            valInput.disabled = true;
            velInput.disabled = true;
        } else {
            valInput.disabled = false;
            velInput.disabled = false;

            if (type === 'cc') {
                valInput.placeholder = "Controller # (0-127)";
                velInput.placeholder = "Value (0-127)";
            } else {
                valInput.placeholder = "Note # (0-127)";
                velInput.placeholder = "Velocity (0-127)";
            }
        }
    });
});
