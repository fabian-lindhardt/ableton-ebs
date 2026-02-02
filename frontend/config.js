// Twitch Extension Helper
const twitch = window.Twitch.ext;

let currentConfig = {
    triggers: []
};
let currentVersion = '0.0.1'; // Default fallback

// Available MIDI Types
const MIDI_TYPES = ['noteon', 'noteoff', 'cc', 'fader', 'start', 'stop'];

// On Init
twitch.configuration.onChanged(() => {
    console.log('Config loaded');
    if (twitch.configuration.broadcaster) {
        console.log('Raw Config:', twitch.configuration.broadcaster.content);
        try {
            // Capture the version if it exists
            if (twitch.configuration.broadcaster.version) {
                const ver = twitch.configuration.broadcaster.version;
                currentVersion = ver;
                console.log('Version detected:', ver);
                // Only set if field is empty (user might be typing)
                const verInput = document.getElementById('config-version');
                if (verInput && verInput.value === '0.0.1') {
                    verInput.value = ver;
                }
            }

            const config = JSON.parse(twitch.configuration.broadcaster.content);
            if (config && config.triggers) {
                currentConfig = config;
                renderTriggers();
            }
        } catch (e) {
            console.error('Invalid config JSON');
        }
    } else {
        console.log('No broadcaster config segment found.');
    }
});

// Render the list of existing triggers
function renderTriggers() {
    const list = document.getElementById('trigger-list');
    list.innerHTML = '';

    currentConfig.triggers.forEach((trigger, index) => {
        const item = document.createElement('div');
        item.className = 'trigger-item';

        // Info Section
        const ch = (trigger.channel || 0) + 1; // Display 1-16
        const info = document.createElement('div');
        info.className = 'trigger-info';
        info.innerHTML = `
            <strong>${trigger.label}</strong> 
            <span class="badge" style="background:${trigger.color}">${trigger.type.toUpperCase()}</span>
            <span style="font-size:0.8em; color:#aaa; margin-left:5px;">Ch: ${ch}</span>
            ${trigger.type === 'noteon' ? ` Note: ${trigger.value} Vel: ${trigger.velocity}` : ''}
            ${trigger.type === 'cc' ? ` CC: ${trigger.controller} Val: ${trigger.value}` : ''}
            ${trigger.type === 'toggle' ? ` Toggle CC: ${trigger.controller} (On:${trigger.value}/Off:${trigger.velocity})` : ''}
            ${trigger.type === 'fader' ? ` Fader CC: ${trigger.controller}` : ''}
            ${trigger.type === 'knob' ? ` Knob CC: ${trigger.controller}` : ''}
            ${trigger.type === 'xypad' ? ` XY Pad CC: ${trigger.controller},${trigger.controllerY}` : ''}
        `;

        // Action Buttons
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '5px';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit'; // Add style for this later or reuse btn
        editBtn.innerText = '✏️';
        editBtn.style.padding = '5px 10px';
        editBtn.style.cursor = 'pointer';
        editBtn.addEventListener('click', () => editTrigger(index));

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete';
        delBtn.innerText = '🗑️';
        delBtn.addEventListener('click', () => deleteTrigger(index));

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

// Add OR Update Trigger
function addTrigger() {
    const editIndex = parseInt(document.getElementById('edit-index').value);

    const label = document.getElementById('new-label').value;
    const type = document.getElementById('new-type').value;
    const value = parseInt(document.getElementById('new-value').value) || 0;
    const velocity = parseInt(document.getElementById('new-velocity').value) || 127;
    const yControl = parseInt(document.getElementById('new-y-controller').value) || 0;
    const cost = parseInt(document.getElementById('new-cost').value) || 0;
    const color = document.getElementById('new-color').value;
    const channelRaw = parseInt(document.getElementById('new-channel').value) || 1;

    // Convert 1-16 to 0-15
    const channel = Math.max(0, Math.min(15, channelRaw - 1));

    if (!label) return alert('Please enter a label');

    const triggerData = {
        id: (editIndex >= 0) ? currentConfig.triggers[editIndex].id : Date.now().toString(),
        label,
        type,
        color,
        cost,
        channel
    };

    // Add specific MIDI data based on type
    if (type === 'noteon' || type === 'noteoff') {
        triggerData.value = value; // Note number
        triggerData.velocity = velocity;
    } else if (type === 'cc') {
        triggerData.controller = value; // CC number
        triggerData.value = velocity;
    } else if (type === 'toggle') {
        triggerData.controller = value; // CC number
        triggerData.value = velocity; // On Value (using velocity field for semantics)
        triggerData.velocity = 0; // Off Value (hardcoded to 0 for now, or add field)
        // Actually, user might want to customize Off value. Let's assume Vel = On, and we need another field or convention.
        // For simplicity now: Val = CC#, Vel = On Value. Off is always 0.
        // Wait, better plan: Let's use the UI fields we have.
        // Label: Val / Note # -> CC #
        // Label: Vel / Desired Val -> On Value
        // We need an Off Value? For now assume 0.
    } else if (type === 'fader' || type === 'knob') {
        triggerData.controller = value; // CC number
        triggerData.value = 0; // Initial Value
    } else if (type === 'xypad') {
        triggerData.controller = value; // X Axis CC
        triggerData.controllerY = yControl; // Y Axis CC
        triggerData.value = 0;
    }
    // Start/Stop don't need values

    if (editIndex >= 0) {
        // Update existing
        currentConfig.triggers[editIndex] = triggerData;
        console.log('Updated trigger at index', editIndex);
    } else {
        // Create new
        currentConfig.triggers.push(triggerData);
        console.log('Added new trigger');
    }

    saveConfig();
    renderTriggers();
    cancelEdit(); // Reset form
}

// Edit Trigger (Populate Form)
function editTrigger(index) {
    const trigger = currentConfig.triggers[index];
    if (!trigger) return;

    document.getElementById('edit-index').value = index;
    document.getElementById('new-label').value = trigger.label;
    document.getElementById('new-type').value = trigger.type;
    document.getElementById('new-color').value = trigger.color;
    document.getElementById('new-cost').value = trigger.cost || 0;
    document.getElementById('new-channel').value = (trigger.channel || 0) + 1;

    // Trigger change event to set input states (disabled/enabled)
    document.getElementById('new-type').dispatchEvent(new Event('change'));

    // Populate Type specific fields
    if (trigger.type === 'noteon') {
        document.getElementById('new-value').value = trigger.value;
        document.getElementById('new-velocity').value = trigger.velocity;
    } else if (trigger.type === 'cc' || trigger.type === 'toggle') {
        document.getElementById('new-value').value = trigger.controller;
        document.getElementById('new-velocity').value = trigger.value;
    } else if (trigger.type === 'fader' || trigger.type === 'knob') {
        document.getElementById('new-value').value = trigger.controller;
    } else if (trigger.type === 'xypad') {
        document.getElementById('new-value').value = trigger.controller;
        document.getElementById('new-y-controller').value = trigger.controllerY;
    }

    // Change UI state
    document.getElementById('btn-add').innerText = 'Update Trigger 💾';
    document.getElementById('btn-cancel').style.display = 'inline-block';
    window.scrollTo(0, document.body.scrollHeight);
}

// Cancel Edit
function cancelEdit() {
    document.getElementById('edit-index').value = '-1';
    document.getElementById('new-label').value = '';
    document.getElementById('new-value').value = '';
    document.getElementById('new-velocity').value = '127';
    document.getElementById('new-channel').value = '1';

    document.getElementById('btn-add').innerText = 'Add Trigger +';
    document.getElementById('btn-cancel').style.display = 'none';
}

// Delete trigger logic
function deleteTrigger(index) {
    if (confirm('Delete this trigger?')) {
        currentConfig.triggers.splice(index, 1);
        saveConfig();
        renderTriggers();

        // If we were editing the deleted item, cancel edit
        if (parseInt(document.getElementById('edit-index').value) == index) {
            cancelEdit();
        }
    } else {
        console.log('Deletion cancelled by user');
    }
}

// Save to Twitch Configuration Service
function saveConfig() {
    const ver = document.getElementById('config-version')?.value || currentVersion || '0.0.1';
    twitch.configuration.set(
        'broadcaster', // segment
        ver, // version (dynamic)
        JSON.stringify(currentConfig) // content
    );
    console.log('Config saved:', currentConfig, 'Version:', ver);
}

// UI Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-add').addEventListener('click', addTrigger);

    const cancelBtn = document.getElementById('btn-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);

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

            // Labels
            const lblVal = document.getElementById('lbl-val');
            const lblVel = document.getElementById('lbl-vel');
            const rowXY = document.getElementById('row-xy');

            // Defaults
            rowXY.style.display = 'none';
            velInput.disabled = false;

            if (type === 'fader' || type === 'knob') {
                velInput.disabled = true;
                lblVal.innerText = "Controller # (0-127)";
                valInput.placeholder = "CC #";
                velInput.placeholder = "Dynamic";
            } else if (type === 'xypad') {
                rowXY.style.display = 'flex';
                velInput.disabled = true;
                lblVal.innerText = "X-Axis CC # (0-127)";
                valInput.placeholder = "CC X";
                velInput.placeholder = "Dynamic";
            } else if (type === 'toggle') {
                lblVal.innerText = "Controller # (0-127)";
                lblVel.innerText = "On Value (0-127)";
                valInput.placeholder = "CC #";
                velInput.placeholder = "127";
            } else if (type === 'cc') {
                lblVal.innerText = "Controller # (0-127)";
                lblVel.innerText = "Value (0-127)";
                valInput.placeholder = "CC #";
                velInput.placeholder = "Value";
            } else {
                // Note
                lblVal.innerText = "Note # (0-127)";
                lblVel.innerText = "Velocity (0-127)";
                valInput.placeholder = "Note";
                velInput.placeholder = "Velocity";
            }
        }
    });
});
