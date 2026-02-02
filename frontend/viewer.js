// Twitch Extension Helper
const twitch = window.Twitch.ext;
let authToken = 'dev-token'; // Default for local testing without Twitch Rig

// Store Triggers
// Store Triggers and States
let activeTriggers = [];
let triggerStates = {}; // Map ID -> boolean/value


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
            console.error('Config/Render Error:', e);
            document.getElementById('dynamic-triggers').innerHTML = `<div class="error">Error loading: ${e.message}</div>`;
        }
    } else {
        console.log('No configuration found');
        document.getElementById('dynamic-triggers').innerHTML = '<div class="empty-state">No triggers configured yet. Go to Extension Config!</div>';
    }
});

// Listen for PubSub Broadcasts (Bi-directional Sync)
twitch.listen('broadcast', (target, contentType, message) => {
    try {
        // message is a JSON string
        const data = JSON.parse(message);
        // console.log('Received Broadcast:', data);

        if (data.type === 'sync') {
            handleSync(data.data);
        }
    } catch (e) {
        console.error('PubSub Error:', e);
    }
});

// Handle External Sync (Ableton -> Bridge -> EBS -> Viewer)
function handleSync(syncData) {
    const { channel, controller, value } = syncData;

    // Find matching triggers
    activeTriggers.forEach((trigger, index) => {
        // Check Channel (Default 0 if undefined) & Controller match
        const trgCh = trigger.channel || 0;

        // Match specific types that receive sync
        if (trigger.type === 'fader' || trigger.type === 'knob') {
            if (trgCh == channel && trigger.controller == controller) {
                // Update UI based on type
                const wrapper = document.querySelector(`.pad[data-id="${trigger.id}"]`);
                if (wrapper) {
                    if (trigger.type === 'fader') {
                        const input = wrapper.querySelector('input');
                        const display = wrapper.querySelector('.fader-value-display');
                        if (input && display) {
                            input.value = value;
                            display.innerText = value;
                            wrapper.style.setProperty('--val-percent', (value / 127) * 100 + '%');
                        }
                    } else if (trigger.type === 'knob') {
                        // Need access to updateKnobVisual... 
                        // Refactor: We defined updateKnobVisual inside renderButtons scope.
                        // Solution: We can re-calculate visual here OR attach the update function to the wrapper DOM element.
                        if (wrapper.updateVisual) {
                            wrapper.updateVisual(value);
                        } else {
                            // Fallback if we didn't attach it (which we haven't yet, so we need to modify renderButtons to attach it)
                            const rotator = wrapper.querySelector('.knob-rotator');
                            const text = wrapper.querySelector('.knob-value-text');
                            const ring = wrapper.querySelector('.knob-value-ring');

                            if (rotator && text && ring) {
                                // Re-implement visual logic briefly or move it helper
                                const minAngle = -135; const maxAngle = 135;
                                const percent = value / 127;
                                const angle = minAngle + (percent * (maxAngle - minAngle));
                                rotator.style.transform = `rotate(${angle}deg)`;
                                text.innerText = value;
                                const circum = 2 * Math.PI * 40;
                                const offset = circum - (percent * (circum * 0.75));
                                ring.style.strokeDashoffset = offset;
                                wrapper.style.setProperty('--item-color', `hsl(${100 + (value)}, 100%, 50%)`);
                            }
                        }
                        // Update internal state if stored?
                        // In Knob logic we have `currentValue` variable in closure.
                        // We can attach `updateValue` to wrapper to handle both visual and state.
                    }
                }
            }
        }
    });
}

function renderButtons() {
    const container = document.getElementById('dynamic-triggers');
    if (!container) return; // Should be in panel.html

    container.innerHTML = ''; // Clear old buttons

    activeTriggers.forEach((trigger, index) => {
        // Wrapper for grid cell
        const wrapper = document.createElement('div');
        wrapper.className = 'pad'; // Base class
        wrapper.dataset.id = trigger.id; // Helpful for debugging

        // Dynamic Styling (Color handled via CSS variable usually, but for user-config color we might need inline var)
        const color = trigger.color || '#9146FF';
        wrapper.style.setProperty('--item-color', color);

        if (trigger.type === 'fader') {
            // --- FADER LOGIC ---
            wrapper.classList.add('type-fader');

            wrapper.innerHTML = `
                <div class="pad-inner">
                    <span class="label">${trigger.label}</span>
                    <div class="fader-value-display">0</div>
                    <input type="range" min="0" max="127" value="0" class="fader-input">
                    ${trigger.cost > 0 ? `<span class="cost">💎 ${trigger.cost}</span>` : ''}
                </div>
            `;

            container.appendChild(wrapper);

            const input = wrapper.querySelector('input');
            const valDisplay = wrapper.querySelector('.fader-value-display');

            // Throttled Sender
            const sendThrottled = throttle((val) => {
                const dynamicTrigger = { ...trigger, value: parseInt(val) };
                sendSmartTrigger(dynamicTrigger);
            }, 50); // Faster response for faders

            input.addEventListener('input', (e) => {
                const val = e.target.value;
                sendThrottled(val);
                valDisplay.innerText = val;
                // Update visual glow or similar if needed
                wrapper.style.setProperty('--val-percent', (val / 127) * 100 + '%');
            });

            // Manual Edit
            makeEditable(valDisplay, () => parseInt(input.value), (newVal) => {
                input.value = newVal;
                // Trigger input event logic manually
                sendThrottled(newVal);
                valDisplay.innerText = newVal;
                wrapper.style.setProperty('--val-percent', (newVal / 127) * 100 + '%');
            });

            input.addEventListener('click', (e) => e.stopPropagation());

        } else if (trigger.type === 'knob') {
            // --- KNOB LOGIC ---
            wrapper.classList.add('type-knob');

            // SVG for Knob
            wrapper.innerHTML = `
                <div class="pad-inner">
                    <span class="label">${trigger.label}</span>
                    <div class="knob-container">
                        <svg viewBox="0 0 100 100" class="knob-svg">
                            <circle cx="50" cy="50" r="40" class="knob-track" />
                            <circle cx="50" cy="50" r="40" class="knob-value-ring" />
                            <!-- Marker Group for rotation -->
                            <g class="knob-rotator">
                                <line x1="50" y1="50" x2="50" y2="15" class="knob-marker" />
                            </g>
                        </svg>
                        <div class="knob-value-text">0</div>
                    </div>
                    ${trigger.cost > 0 ? `<span class="cost">💎 ${trigger.cost}</span>` : ''}
                </div>
            `;

            container.appendChild(wrapper);

            const knobContainer = wrapper.querySelector('.knob-container');
            const rotator = wrapper.querySelector('.knob-rotator');
            const valueText = wrapper.querySelector('.knob-value-text');
            const valueRing = wrapper.querySelector('.knob-value-ring');

            // Knob State
            let currentValue = 0;
            const minAngle = -135;
            const maxAngle = 135;

            // Helper to update visual
            const updateKnobVisual = (val) => {
                // Map 0-127 to -135 to 135 deg
                const percent = val / 127;
                const angle = minAngle + (percent * (maxAngle - minAngle));

                rotator.style.transform = `rotate(${angle}deg)`;
                rotator.style.transformOrigin = '50px 50px';

                valueText.innerText = val;

                // Update Ring Dashoffset (Circumference ~251)
                const circumference = 2 * Math.PI * 40;
                const offset = circumference - (percent * (circumference * 0.75)); // 75% circle stroke
                valueRing.style.strokeDasharray = `${circumference} ${circumference}`;
                valueRing.style.strokeDashoffset = offset;

                wrapper.style.setProperty('--item-color', `hsl(${100 + (val)}, 100%, 50%)`); // Dynamic Color Shift? optional
            };

            // Init
            updateKnobVisual(0);

            // Expose for Sync
            wrapper.updateVisual = (val) => {
                currentValue = parseInt(val);
                updateKnobVisual(currentValue);
            };

            // Throttled Sender
            const sendThrottled = throttle((val) => {
                sendSmartTrigger({ ...trigger, value: parseInt(val) });
            }, 50);

            // Manual Edit
            makeEditable(valueText, () => currentValue, (newVal) => {
                // Use the exposed updater
                wrapper.updateVisual(newVal);
                sendThrottled(newVal);
            });

            // Drag Logic
            let isDragging = false;
            let startY = 0;
            let startValue = 0;

            const handleStart = (y) => {
                isDragging = true;
                startY = y;
                startValue = currentValue;
                knobContainer.classList.add('dragging');
            };

            const handleMove = (y) => {
                if (!isDragging) return;
                const deltaY = startY - y; // Up is positive
                const sensitivity = 2; // Pixels per step

                let newVal = startValue + Math.floor(deltaY / sensitivity);
                newVal = Math.max(0, Math.min(127, newVal));

                if (newVal !== currentValue) {
                    currentValue = newVal;
                    updateKnobVisual(currentValue);
                    sendThrottled(currentValue);
                }
            };

            const handleEnd = () => {
                isDragging = false;
                knobContainer.classList.remove('dragging');
            };

            knobContainer.addEventListener('mousedown', (e) => handleStart(e.clientY));
            document.addEventListener('mousemove', (e) => handleMove(e.clientY));
            document.addEventListener('mouseup', handleEnd);

            knobContainer.addEventListener('touchstart', (e) => { handleStart(e.touches[0].clientY); e.preventDefault(); });
            document.addEventListener('touchmove', (e) => { handleMove(e.touches[0].clientY); });
            document.addEventListener('touchend', handleEnd);


        } else if (trigger.type === 'xypad') {
            // --- XY PAD LOGIC ---
            wrapper.classList.add('type-xypad');

            wrapper.innerHTML = `
                <div class="xypad-container" id="xy-${index}">
                    <div class="xypad-label">${trigger.label}</div>
                    <div class="xypad-grid"></div>   
                    <div class="xypad-handle" style="left: 50%; top: 50%;"></div>
                </div>
             `;

            container.appendChild(wrapper);

            // Attach Events
            const pad = wrapper.querySelector('.xypad-container');
            const handle = wrapper.querySelector('.xypad-handle');

            const updateXY = (clientX, clientY) => {
                const rect = pad.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

                // Update visual
                handle.style.left = `${x * 100}%`;
                handle.style.top = `${y * 100}%`;

                // MIDI Values
                const valX = Math.floor(x * 127);
                const valY = Math.floor((1 - y) * 127);

                sendXYThrottled(valX, valY);
            };

            const sendXYThrottled = throttle((x, y) => {
                sendSmartTrigger({ ...trigger, controller: trigger.controller, value: x, type: 'cc' });
                sendSmartTrigger({ ...trigger, controller: trigger.controllerY, value: y, type: 'cc' });
            }, 50);

            let isDragging = false;

            pad.addEventListener('mousedown', (e) => { isDragging = true; updateXY(e.clientX, e.clientY); });
            document.addEventListener('mousemove', (e) => { if (isDragging) updateXY(e.clientX, e.clientY); });
            document.addEventListener('mouseup', () => { isDragging = false; });

            // Touch support
            pad.addEventListener('touchstart', (e) => { isDragging = true; updateXY(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); });
            pad.addEventListener('touchmove', (e) => { if (isDragging) updateXY(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); });
            pad.addEventListener('touchend', () => { isDragging = false; });

        } else {
            // --- BUTTON LOGIC (Normal & Toggle) ---
            wrapper.classList.add('type-btn');

            // Check toggle state
            let isToggled = false;
            if (trigger.type === 'toggle' && triggerStates[trigger.id]) {
                isToggled = true;
                wrapper.classList.add('btn-active');
            }

            wrapper.innerHTML = `
                <div class="pad-content">
                    <span class="label">${trigger.label}</span>
                    ${trigger.cost > 0 ? `<span class="cost">💎 ${trigger.cost}</span>` : ''}
                </div>
                <div class="pad-glow"></div>
            `;

            wrapper.addEventListener('click', () => {
                if (trigger.type === 'toggle') {
                    isToggled = !isToggled;
                    triggerStates[trigger.id] = isToggled;

                    if (isToggled) {
                        wrapper.classList.add('btn-active');
                        sendSmartTrigger({ ...trigger, value: trigger.value, type: 'cc' });
                    } else {
                        wrapper.classList.remove('btn-active');
                        sendSmartTrigger({ ...trigger, value: 0, type: 'cc' });
                    }
                } else {
                    // Flash Animation via CSS class
                    wrapper.classList.add('btn-flash');
                    setTimeout(() => wrapper.classList.remove('btn-flash'), 200);
                    sendSmartTrigger(trigger);
                }
            });

            container.appendChild(wrapper);
        }
    });
}

// Helper: Throttle
function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function () {
        const context = this;
        const args = arguments;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function () {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    }
}


// Keep the localhost URL for now, but in production this should be relative or configured
const EBS_API = 'https://abletonlivechat.flairtec.de/api/trigger';

async function sendCommand(type) {
    updateStatus('Transport: ' + type);
    const payload = {
        action: type,
        midi: { action: type }
    };
    await sendEBS(payload);
}

async function sendSmartTrigger(trigger) {
    // Only show status updates for non-fader triggers to avoid log spam
    if (trigger.type !== 'fader') {
        updateStatus(`Sending: ${trigger.label}...`);
    }

    // Construct specific MIDI payload based on type
    // This cleaning ensures logs are readable and correct
    let midiData = {
        action: trigger.type,
        channel: trigger.channel || 0, // Use Configured Channel
        value: trigger.value
    };

    if (trigger.type === 'noteon' || trigger.type === 'noteoff') {
        midiData.note = trigger.value;       // Note Number
        midiData.velocity = trigger.velocity;
    } else if (trigger.type === 'cc' || trigger.type === 'fader') {
        midiData.controller = trigger.controller; // CC Number
        midiData.value = trigger.value;          // CC Value
        // 'note' is undefined here, removing ambiguity
    }

    const payload = {
        action: 'trigger',
        midi: midiData
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
        // Silent success for faders
        if (data.success) {
            if (payload.midi.action !== 'fader') {
                updateStatus('Sent!');
                setTimeout(() => updateStatus('Ready'), 2000);
            }
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

// Helper: Make Element Text Editable
function makeEditable(displayElement, getValue, onCommit) {
    displayElement.style.cursor = 'text';
    displayElement.title = "Click to type value";

    displayElement.addEventListener('click', (e) => {
        e.stopPropagation(); // Don't trigger pad click
        const initialVal = getValue();

        displayElement.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = 0;
        input.max = 127;
        input.value = initialVal;
        input.className = 'val-edit-input';

        // Insert input where display was
        displayElement.parentNode.insertBefore(input, displayElement);
        input.focus();
        input.select();

        const finish = () => {
            let val = parseInt(input.value);
            if (isNaN(val)) val = initialVal;
            val = Math.max(0, Math.min(127, val));

            onCommit(val); // Callback to update parent logic

            input.remove();
            displayElement.style.display = ''; // Show display again
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                input.blur(); // Triggers finish
            }
            ev.stopPropagation(); // Stop Enter from doing other things
        });
        input.addEventListener('click', (ev) => ev.stopPropagation());
        input.addEventListener('mousedown', (ev) => ev.stopPropagation()); // Prevent drag starts
    });
}
