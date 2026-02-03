// Twitch Extension Helper
const MAX_TRIGGERS = 12;
let activeTriggers = [];
let authToken = '';
let currentVdoId = null;

// MOCK CONFIGURATION for Localhost
const MOCK_CONFIG = {
    triggers: [
        { id: 1, type: 'fader', label: 'Volume', channel: 1, controller: 1, style: 'cyan' },
        { id: 2, type: 'knob', label: 'Filter', channel: 1, controller: 2, style: 'pink' },
        { id: 3, type: 'button', label: 'Kick', channel: 1, note: 36, style: 'red' },
        { id: 4, type: 'xy', label: 'Chaos', channel: 1, controllerX: 10, controllerY: 11 }
    ]
};

const twitch = window.Twitch ? window.Twitch.ext : null;
// Default for local testing without Twitch Rig
if (!twitch || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    authToken = 'dev-token';
}

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    // Override triggers if no config found
    setTimeout(() => {
        if (activeTriggers.length === 0) {
            console.log("Localhost: Loading MOCK Configuration for testing.");
            activeTriggers = MOCK_CONFIG.triggers;
            renderButtons();
            updateStatus('Dev Mode: Mock Config Loaded');
        }
        // Force initialization on localhost if onAuthorized won't fire
        if (authToken === 'dev-token') {
            fetchState();
            checkSession();
        }
    }, 1500);

    // --- LOCAL WEBSOCKET SYNC FALLBACK ---
    const localWs = new WebSocket('ws://localhost:8080');
    localWs.onopen = () => console.log('Connected to local EBS WebSocket for Sync.');
    localWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'sync') {
                console.log('Received Local Sync:', data.data);
                handleSync(data.data);
            }
        } catch (e) {
            console.error('Local WS Parse Error:', e);
        }
    };
    localWs.onclose = () => console.warn('Local EBS WebSocket closed.');

    // Show Dev Settings
    setTimeout(() => {
        const devSet = document.getElementById('dev-settings');
        if (devSet) devSet.style.display = 'block';
        const devInp = document.getElementById('dev-vdo-id');
        if (devInp) {
            devInp.value = localStorage.getItem('dev_vdo_id') || 'ZtDACFm';
            devInp.addEventListener('change', (e) => {
                let val = e.target.value.trim();
                // Try to extract ID if it's a URL
                if (val.includes('vdo.ninja')) {
                    try {
                        const url = new URL(val);
                        val = url.searchParams.get('view') || url.searchParams.get('push') || val;
                    } catch (e) { }
                }
                localStorage.setItem('dev_vdo_id', val);
                updateStatus('VDO ID Updated');
            });
        }
    }, 1000);
}

// Store Triggers and States
let triggerStates = {}; // Map ID -> boolean/value

// Add Static Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-start')?.addEventListener('click', () => sendCommand('start'));
    document.getElementById('btn-stop')?.addEventListener('click', () => sendCommand('stop'));
});

// Listen for Config Changes (Load Dynamic Buttons)
if (twitch) {
    twitch.configuration.onChanged(() => {
        console.log('Config Changed Event');
        if (twitch.configuration.broadcaster) {
            try {
                const config = JSON.parse(twitch.configuration.broadcaster.content);
                if (config) {
                    if (config.triggers) {
                        console.log('Loading Triggers:', config.triggers);
                        activeTriggers = config.triggers;
                        renderButtons();
                    }
                    if (config.globalVdoId) {
                        console.log('Production VDO ID loaded:', config.globalVdoId);
                        currentVdoId = config.globalVdoId;
                    }
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
            console.log('--- PubSub Message Received ---');
            console.log('Target:', target);
            console.log('Content-Type:', contentType);
            console.log('Raw Message:', message);

            let data = JSON.parse(message);
            // Handle double-stringification if it occurs
            if (typeof data === 'string') data = JSON.parse(data);

            console.log('Parsed Payload:', data);

            if (data.type === 'sync') {
                handleSync(data.data);
            }
        } catch (e) {
            console.error('PubSub Parsing Error:', e);
        }
    });

    // --- BITS TRANSACTIONS ---
    // Listen for completed Bits transactions
    twitch.bits.onTransactionComplete((transaction) => {
        console.log('[Bits] Transaction Complete!', transaction);

        const sku = transaction.product.sku;
        const transactionId = transaction.transactionId;

        // Report to EBS
        fetch(EBS_BASE + '/api/transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ sku, transactionId })
        })
            .then(r => r.json())
            .then(data => {
                console.log('[Bits] EBS Response:', data);
                if (data.success && data.session) {
                    activateVip(data.session.expiresAt);
                }
            })
            .catch(e => console.error('[Bits] EBS Error:', e));
    });

    // Show Products Available for Purchase
    twitch.bits.getProducts().then(products => {
        console.log('[Bits] Products Available:', products);
        window.bitsProducts = products;
    }).catch(e => console.error('[Bits] Get Products Error:', e));
}

// Handle Unlock Button Click (Bits Purchase or Dev Session)
function handleUnlockClick() {
    if (!twitch) {
        // Dev mode: activate for free
        console.log('[DEV] Simulating VIP activation...');
        fetch(EBS_BASE + '/api/dev-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ userId: 'dev-user', durationMs: 5 * 60 * 1000 })
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    activateVip(data.session.expiresAt);
                }
            });
        return;
    }

    // Use SKU 'vip_5min' for production
    const sku = 'vip_5min';
    console.log('[Bits] Initiating purchase for:', sku);
    twitch.bits.useBits(sku);
}

// Handle External Sync (Ableton -> Bridge -> EBS -> Viewer)
function handleSync(syncData) {
    const { channel, controller, value } = syncData;

    // Find matching triggers
    activeTriggers.forEach((trigger) => {
        const trgCh = trigger.channel || 0;

        // Exact Match requested by user to support multi-channel setups
        console.log(`[Sync-Check] Match test: Trigger(${trigger.label}) Ch:${trgCh} CC:${trigger.controller} vs Sync Ch:${channel} CC:${controller}`);
        if (trgCh == channel && (trigger.controller == controller || trigger.controllerY == controller)) {
            console.log(`[Sync-Match!!] Updating ${trigger.label} to ${value}`);
            const wrapper = document.querySelector(`.pad[data-id="${trigger.id}"]`);
            if (wrapper) {
                if (trigger.type === 'fader') {
                    const input = wrapper.querySelector('input');
                    const display = wrapper.querySelector('.fader-value-display');
                    if (input && display) {
                        if (wrapper.isDragging) return;
                        input.value = value;
                        display.innerText = value;
                        wrapper.style.setProperty('--val-percent', (value / 127) * 100 + '%');
                    }
                } else if (trigger.type === 'knob') {
                    if (wrapper.updateVisual) {
                        wrapper.updateVisual(value);
                    } else {
                        const rotator = wrapper.querySelector('.knob-rotator');
                        const text = wrapper.querySelector('.knob-value-text');
                        const ring = wrapper.querySelector('.knob-value-ring');

                        if (rotator && text && ring) {
                            const minAngle = -135; const maxAngle = 135;
                            const percent = value / 127;
                            const angle = minAngle + (percent * (maxAngle - minAngle));
                            rotator.style.transform = `rotate(${angle}deg)`;
                            rotator.style.transformOrigin = '50px 50px';
                            text.innerText = value;
                            const circum = 2 * Math.PI * 40;
                            const offset = circum - (percent * (circum * 0.75));
                            ring.style.strokeDashoffset = offset;
                            wrapper.style.setProperty('--item-color', `hsl(${100 + (value)}, 100%, 50%)`);
                        }
                    }
                } else if (trigger.type === 'xy' || trigger.type === 'xypad') {
                    if (wrapper.updateVisual) {
                        wrapper.updateVisual(controller, value);
                    }
                } else if (trigger.type === 'toggle') {
                    if (wrapper.updateVisual) {
                        wrapper.updateVisual(value);
                    }
                }
            }
        }
    });
}

function renderButtons() {
    const container = document.getElementById('dynamic-triggers');
    if (!container) return;

    container.innerHTML = '';

    activeTriggers.forEach((trigger, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'pad';
        wrapper.dataset.id = trigger.id;
        const color = trigger.color || '#9146FF';
        wrapper.style.setProperty('--item-color', color);

        if (trigger.type === 'fader') {
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
            const sendThrottled = throttle((val) => {
                sendSmartTrigger({ ...trigger, value: parseInt(val) });
            }, 50);

            input.addEventListener('input', (e) => {
                const val = e.target.value;
                sendThrottled(val);
                valDisplay.innerText = val;
                wrapper.style.setProperty('--val-percent', (val / 127) * 100 + '%');
            });

            wrapper.isDragging = false;
            const startDrag = () => { wrapper.isDragging = true; };
            const stopDrag = () => { wrapper.isDragging = false; };
            input.addEventListener('mousedown', startDrag);
            input.addEventListener('touchstart', startDrag);
            input.addEventListener('mouseup', stopDrag);
            input.addEventListener('touchend', stopDrag);

            makeEditable(valDisplay, () => parseInt(input.value), (newVal) => {
                input.value = newVal;
                sendThrottled(newVal);
                valDisplay.innerText = newVal;
                wrapper.style.setProperty('--val-percent', (newVal / 127) * 100 + '%');
            });
        } else if (trigger.type === 'knob') {
            wrapper.classList.add('type-knob');
            wrapper.innerHTML = `
                <div class="pad-inner">
                    <span class="label">${trigger.label}</span>
                    <div class="knob-container">
                        <svg viewBox="0 0 100 100" class="knob-svg">
                            <circle cx="50" cy="50" r="40" class="knob-track" />
                            <circle cx="50" cy="50" r="40" class="knob-value-ring" />
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

            let currentValue = 0;
            const minAngle = -135;
            const maxAngle = 135;
            wrapper.isDragging = false;

            const updateKnobVisual = (val) => {
                const percent = val / 127;
                const angle = minAngle + (percent * (maxAngle - minAngle));
                rotator.style.transform = `rotate(${angle}deg)`;
                rotator.style.transformOrigin = '50px 50px';
                valueText.innerText = val;
                const circumference = 2 * Math.PI * 40;
                const maxArc = circumference * 0.75;
                const isPan = (trigger.style === 'pan') || (trigger.label.toLowerCase().includes('pan'));

                if (isPan) {
                    const centerArc = maxArc / 2;
                    let dashLength = 0, startOffset = 0;
                    if (val >= 64) {
                        dashLength = ((val - 64) / 63.5) * centerArc;
                        startOffset = centerArc;
                    } else {
                        dashLength = ((64 - val) / 64) * centerArc;
                        startOffset = centerArc - dashLength;
                    }
                    valueRing.style.strokeDasharray = `${dashLength} ${circumference}`;
                    valueRing.style.strokeDashoffset = -startOffset;
                } else {
                    const offset = circumference - (percent * maxArc);
                    valueRing.style.strokeDasharray = `${circumference} ${circumference}`;
                    valueRing.style.strokeDashoffset = offset;
                    wrapper.style.setProperty('--item-color', `hsl(${100 + (val)}, 100%, 50%)`);
                }
            };

            const initialVal = (trigger.style === 'pan' || trigger.label.toLowerCase().includes('pan')) ? 64 : 0;
            updateKnobVisual(initialVal);
            currentValue = initialVal;

            wrapper.updateVisual = (val) => {
                if (wrapper.isDragging) return;
                currentValue = parseInt(val);
                updateKnobVisual(currentValue);
            };

            const sendThrottled = throttle((val) => {
                sendSmartTrigger({ ...trigger, value: parseInt(val) });
            }, 50);

            makeEditable(valueText, () => currentValue, (newVal) => {
                currentValue = newVal;
                updateKnobVisual(newVal);
                sendThrottled(newVal);
            });

            let startY = 0, startValue = 0;
            const handleStart = (y) => {
                wrapper.isDragging = true;
                startY = y; startValue = currentValue;
                document.body.style.cursor = 'ns-resize';
                knobContainer.classList.add('dragging');
            };
            const handleMove = (y) => {
                if (!wrapper.isDragging) return;
                let newVal = Math.max(0, Math.min(127, startValue + Math.floor((startY - y) / 2)));
                if (newVal !== currentValue) {
                    currentValue = newVal;
                    updateKnobVisual(currentValue);
                    sendThrottled(currentValue);
                }
            };
            const handleEnd = () => {
                wrapper.isDragging = false;
                document.body.style.cursor = '';
                knobContainer.classList.remove('dragging');
            };

            knobContainer.addEventListener('mousedown', (e) => { e.preventDefault(); handleStart(e.clientY); });
            document.addEventListener('mousemove', (e) => handleMove(e.clientY));
            document.addEventListener('mouseup', handleEnd);
            knobContainer.addEventListener('touchstart', (e) => { e.preventDefault(); handleStart(e.touches[0].clientY); });
            document.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientY));
            document.addEventListener('touchend', handleEnd);

        } else if (trigger.type === 'xy' || trigger.type === 'xypad') {
            wrapper.classList.add('type-xypad');
            wrapper.innerHTML = `
                <div class="xypad-container" id="xy-${trigger.id}">
                    <div class="xypad-label">${trigger.label}</div>
                    <div class="xypad-grid"></div>   
                    <div class="xypad-handle" style="left: 50%; top: 50%;"></div>
                    <div class="xypad-learn-btns">
                        <button class="learn-btn-x" title="Learn X Axis">X</button>
                        <button class="learn-btn-y" title="Learn Y Axis">Y</button>
                    </div>
                </div>
            `;
            container.appendChild(wrapper);
            const pad = wrapper.querySelector('.xypad-container');
            const handle = wrapper.querySelector('.xypad-handle');

            // Learn Buttons Logic
            const btnX = wrapper.querySelector('.learn-btn-x');
            const btnY = wrapper.querySelector('.learn-btn-y');

            btnX.addEventListener('click', (e) => {
                e.stopPropagation();
                updateStatus(`Mapping X to CC ${trigger.controller || trigger.controllerX}`);
                sendSmartTrigger({ ...trigger, controller: trigger.controller || trigger.controllerX, value: 64, type: 'cc' });
            });

            btnY.addEventListener('click', (e) => {
                e.stopPropagation();
                updateStatus(`Mapping Y to CC ${trigger.controllerY}`);
                sendSmartTrigger({ ...trigger, controller: trigger.controllerY, value: 64, type: 'cc' });
            });

            const sendXYThrottled = throttle((x, y) => {
                sendSmartTrigger({ ...trigger, controller: trigger.controller || trigger.controllerX, value: x, type: 'cc' });
                sendSmartTrigger({ ...trigger, controller: trigger.controllerY, value: y, type: 'cc' });
            }, 50);

            wrapper.valX = 64;
            wrapper.valY = 64;

            wrapper.updateVisual = (cc, val) => {
                if (wrapper.isDragging) return;

                if (cc == (trigger.controller || trigger.controllerX)) {
                    wrapper.valX = val;
                } else if (cc == trigger.controllerY) {
                    wrapper.valY = val;
                }

                const posX = (wrapper.valX / 127) * 100;
                const posY = (1 - (wrapper.valY / 127)) * 100;
                handle.style.left = posX + '%';
                handle.style.top = posY + '%';
            };

            const updateXY = (clientX, clientY) => {
                const rect = pad.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
                handle.style.left = (x * 100) + '%';
                handle.style.top = (y * 100) + '%';

                wrapper.valX = Math.floor(x * 127);
                wrapper.valY = Math.floor((1 - y) * 127);
                sendXYThrottled(wrapper.valX, wrapper.valY);
            };

            wrapper.isDragging = false;
            pad.addEventListener('mousedown', (e) => { wrapper.isDragging = true; updateXY(e.clientX, e.clientY); });
            document.addEventListener('mousemove', (e) => { if (wrapper.isDragging) updateXY(e.clientX, e.clientY); });
            document.addEventListener('mouseup', () => { wrapper.isDragging = false; });
            pad.addEventListener('touchstart', (e) => { wrapper.isDragging = true; updateXY(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); });
            document.addEventListener('touchmove', (e) => { if (wrapper.isDragging) updateXY(e.touches[0].clientX, e.touches[0].clientY); });
            document.addEventListener('touchend', () => { wrapper.isDragging = false; });

        } else if (['start', 'stop', 'pause', 'restart'].includes(trigger.type)) {
            wrapper.classList.add('type-transport');

            let icon = '▶';
            if (trigger.type === 'stop') icon = '◼';
            if (trigger.type === 'pause') icon = '⏸';
            if (trigger.type === 'restart') icon = '⏮';

            wrapper.innerHTML = `
                <div class="pad-inner transport-inner">
                    <span class="transport-icon">${icon}</span>
                    ${trigger.cost > 0 ? `<span class="cost">💎 ${trigger.cost}</span>` : ''}
                </div>
            `;

            wrapper.classList.add('controls-widget');

            wrapper.onclick = (e) => {
                if (isEditMode) return;
                wrapper.classList.add('btn-flash');
                setTimeout(() => wrapper.classList.remove('btn-flash'), 200);
                sendCommand(trigger.type);
            };

            container.appendChild(wrapper);

        } else {
            wrapper.classList.add('type-btn');
            let isToggled = false;
            if (trigger.type === 'toggle' && triggerStates[trigger.id]) {
                isToggled = true; wrapper.classList.add('btn-active');
            }
            wrapper.innerHTML = `<div class="pad-content"><span class="label">${trigger.label}</span>${trigger.cost > 0 ? `<span class="cost">💎 ${trigger.cost}</span>` : ''}</div><div class="pad-glow"></div>`;
            wrapper.updateVisual = (val) => {
                const active = val >= 64;
                triggerStates[trigger.id] = active;
                if (active) wrapper.classList.add('btn-active');
                else wrapper.classList.remove('btn-active');
            };

            wrapper.addEventListener('click', () => {
                if (trigger.type === 'toggle') {
                    const currentState = triggerStates[trigger.id] || false;
                    const newState = !currentState;
                    triggerStates[trigger.id] = newState;
                    wrapper.updateVisual(newState ? 127 : 0);
                    sendSmartTrigger({ ...trigger, value: newState ? 127 : 0, type: 'cc' });
                } else {
                    wrapper.classList.add('btn-flash'); setTimeout(() => wrapper.classList.remove('btn-flash'), 200);
                    sendSmartTrigger(trigger);
                }
            });
            container.appendChild(wrapper);
        }
    });
}

function throttle(func, limit) {
    let lastFunc, lastRan;
    return function () {
        const context = this, args = arguments;
        if (!lastRan) { func.apply(context, args); lastRan = Date.now(); }
        else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(() => {
                if ((Date.now() - lastRan) >= limit) { func.apply(context, args); lastRan = Date.now(); }
            }, limit - (Date.now() - lastRan));
        }
    }
}

const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const EBS_BASE = IS_LOCAL ? 'http://localhost:8080' : 'https://abletonlivechat.flairtec.de';
const EBS_API = `${EBS_BASE}/api/trigger`;
async function sendCommand(type) {
    updateStatus('Transport: ' + type);
    await sendEBS({ action: type, midi: { action: type } });
}

async function sendSmartTrigger(trigger) {
    if (trigger.type !== 'fader') updateStatus(`Sending: ${trigger.label}...`);
    let midiData = {
        action: trigger.type,
        channel: (typeof trigger.channel !== 'undefined') ? trigger.channel : 0,
        value: trigger.value
    };
    if (trigger.type === 'noteon' || trigger.type === 'noteoff') {
        midiData.note = trigger.note || trigger.value;
        midiData.velocity = trigger.velocity || 100;
    } else {
        midiData.controller = trigger.controller;
    }
    await sendEBS({ action: 'trigger', midi: midiData });
}

async function sendEBS(payload) {
    try {
        const res = await fetch(EBS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
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

if (twitch) {
    twitch.onAuthorized((auth) => {
        authToken = auth.token;
        updateStatus('Connected to Twitch!');
        fetchState();
        checkSession();
    });
}

async function fetchState() {
    try {
        const res = await fetch(EBS_API.replace('/trigger', '/state'), {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            const state = await res.json();
            applyState(state);
        }
    } catch (e) { console.error('Failed to fetch state:', e); }
}

function applyState(state) {
    Object.keys(state).forEach(key => {
        const [ch, cc] = key.split('-').map(Number);
        handleSync({ channel: ch, controller: cc, value: state[key] });
    });
}

let vipExpiresAt = 0, timerInterval = null;

function checkSession() {
    console.log("Checking session status...");
    fetch(EBS_API.replace('/trigger', '/session'), {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
        .then(res => res.json())
        .then(data => {
            console.log("Session Check Result:", data);
            if (data.success && data.session && (data.session.active || data.session.isActive)) {
                console.log("Active session found, activating VIP.");
                activateVip(data.session.expiresAt);
            } else {
                console.log("No active session, locking UI.");
                lockInterface();
            }
        })
        .catch(err => {
            console.warn('EBS unreachable or error:', err);
            lockInterface();
        });
}

const hasVIP = () => document.getElementById('app').classList.contains('is-vip');

function lockInterface() {
    console.log("UI set to Preview Mode.");
    document.getElementById('app').classList.remove('is-vip');
    // Lock logic is now handled by event capturing
    const container = document.getElementById('audio-container');
    if (container) container.innerHTML = '';
    if (timerInterval) clearInterval(timerInterval);
}

function activateVip(expiresAt) {
    console.log("VIP activated until:", new Date(expiresAt).toLocaleTimeString());
    vipExpiresAt = expiresAt;
    document.getElementById('app').classList.add('is-vip');
    if (timerInterval) clearInterval(timerInterval);
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 1000);

    const container = document.getElementById('audio-container');
    if (container) container.innerHTML = '<audio id="vdo-audio" autoplay playsinline></audio>'; // Ensure audio element exists

    // Auto-Join Audio if activated? No, user must click join (browser audio policy)
    // But we SHOW the button
    const joinBtn = document.getElementById('btn-join-audio');
    if (joinBtn) {
        joinBtn.style.display = 'block';
        // Remove old listeners to prevent duplicates (assign new one)
        joinBtn.onclick = () => {
            console.log("Join Audio clicked! Starting Stream...");
            startAudioStream();
            joinBtn.style.display = 'none';
        };
    }

    // Ensure Modal is hidden
    if (typeof hideUnlockModal === 'function') hideUnlockModal();
}

// --- Interaction Interceptor (The Paywall) ---
document.addEventListener('mousedown', interceptInteraction, true); // Capture phase!
document.addEventListener('click', interceptInteraction, true);     // Capture phase!
document.addEventListener('touchstart', interceptInteraction, { capture: true, passive: false });

function interceptInteraction(e) {
    // Whitelist
    if (checkWhitelist(e.target)) return;

    // Broadcaster always allowed
    if (isBroadcaster()) return;

    // VIP always allowed
    if (hasVIP()) return;

    // Block Interaction & Show Modal
    e.stopPropagation();
    e.preventDefault();
    console.log('[Preview] Interaction blocked. Opening modal.');
    showUnlockModal();
}

function checkWhitelist(target) {
    // Allow Unlock Modal Interactions
    if (target.closest('.modal-content')) return true;
    if (target.closest('.modal-overlay')) return true;
    // Allow Dev Settings (if overlay visible)
    if (target.closest('#dev-settings')) return true;
    // Allow Edit Mode (if broadcaster fails to detect but we want to allow edit clicks - actually intercept handles this via isBroadcaster)

    // Stop propagation if it's a control, join button, OR static controls (Play/Stop)
    const isControl = target.closest('#dynamic-triggers') ||
        target.closest('#btn-join-audio') ||
        target.closest('.controls') || // Legacy block
        target.closest('.controls-widget'); // New Grid Transport

    if (!isControl) return true; // Allow clicking empty space

    return false;
}

// Modal Logic
const modal = document.getElementById('unlock-modal');
const closeModal = document.getElementById('btn-close-modal');
const headerUnlockBtn = document.getElementById('btn-header-unlock');

function showUnlockModal() {
    modal.style.display = 'flex';
}

function hideUnlockModal() {
    modal.style.display = 'none';
}

if (closeModal) closeModal.onclick = hideUnlockModal;
if (headerUnlockBtn) headerUnlockBtn.onclick = showUnlockModal;
// Unlock button click handled by existing listener (triggerTransaction/Dev)

function startAudioStream() {
    // 1. Production Config (Broadcaster/Global)
    let vdoId = currentVdoId || "bhpkXZU";
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        vdoId = localStorage.getItem('dev_vdo_id') || vdoId;
    }

    // Direct WebRTC Setup (Bypasses iFrame CSP)
    const domain = (vdoId && vdoId.includes('.')) ? vdoId.split('/')[2] || vdoId : "vdo.flairtec.de";
    const room = vdoId.includes('view=') ? vdoId.split('view=')[1].split('&')[0] : vdoId;

    console.log("[SolutionC-v16] Initializing direct WebRTC receiver for:", domain, "Room:", room);

    // Use the pre-loaded receiver instance (Solution C)
    if (window.vdoReceiver) {
        console.log("[VDO] Starting pre-loaded AudioReceiver...");
        window.vdoReceiver.start('vdo-audio');
    } else {
        console.error("[VDO] vdoReceiver not found! Script load error?");
    }
}

function updateTimerDisplay() {
    const remaining = Math.max(0, vipExpiresAt - Date.now());
    if (remaining === 0) { lockInterface(); return; }
    const s = Math.floor((remaining / 1000) % 60);
    const m = Math.floor(remaining / 60000);
    document.getElementById('vip-timer').innerText = `VIP: ${m}:${s.toString().padStart(2, '0')}`;
}

const joinAudioBtn = document.getElementById('btn-join-audio');
if (joinAudioBtn) {
    joinAudioBtn.addEventListener('click', () => {
        console.log("[SolutionC-v16] Join Audio button clicked. Ensuring receiver is active...");
        if (window.vdoReceiver) {
            // Re-trigger join if needed or handle audio context resume
            console.log("[SolutionC-v16] Signaling ready...");
            if (window.vdoReceiver.ws && window.vdoReceiver.ws.readyState === 1) {
                window.vdoReceiver.send({
                    type: 'viewer-ready',
                    room: window.vdoReceiver.roomID,
                    sender: window.vdoReceiver.myId
                });
            } else {
                console.warn("[VDO] WS not ready, cannot re-signal.");
            }
        }
    });
}

const unlockBtn = document.getElementById('btn-unlock');
if (unlockBtn) {
    console.log("Unlock button found, attaching listener.");
    unlockBtn.addEventListener('click', () => {
        console.log("Unlock button CLICKED!");
        // Force local transaction if on localhost OR if user is broadcaster
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const isBroadcaster = window.Twitch && window.Twitch.ext.viewer && window.Twitch.ext.viewer.role === 'broadcaster';

        if (twitch && twitch.bits && !isLocal && !isBroadcaster) {
            console.log("Using Twitch Bits API...");
            twitch.bits.useBits('vip_5min');
        } else {
            console.log("Using Transaction Simulation (EBS)...");
            fetch(EBS_API.replace('/trigger', '/transaction'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify({ sku: 'vip_5min', transactionId: 'dev-' + Date.now() })
            })
                .then(res => {
                    console.log("Transaction response status:", res.status);
                    return res.json();
                })
                .then(data => {
                    console.log("Transaction data received:", data);
                    if (data.success) {
                        console.log("Activating VIP from transaction!");
                        activateVip(data.session.expiresAt);
                    } else {
                        updateStatus('Transaction Failed: ' + data.message);
                    }
                })
                .catch(err => {
                    console.error("Transaction Fetch Error:", err);
                    updateStatus('Connection Error');
                });
        }
    });
} else {
    console.warn("Unlock button NOT found in DOM!");
}

function makeEditable(el, getVal, onCommit) {
    el.style.cursor = 'text';
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        const init = getVal();
        el.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'number'; input.value = init; input.className = 'val-edit-input';
        el.parentNode.insertBefore(input, el);
        input.focus(); input.select();
        const done = () => {
            let v = Math.max(0, Math.min(127, parseInt(input.value) || init));
            onCommit(v);
            input.remove(); el.style.display = '';
        };
        input.addEventListener('blur', done);
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); ev.stopPropagation(); });
    });
}

// ==================================================
// POP-OUT GRID LAYOUT SYSTEM 🎛️📐
// ==================================================

const POPOUT_WIDTH_THRESHOLD = 450; // Width above which we consider "pop-out"
let isPopoutMode = false;
let isEditMode = false;
let draggedElement = null;

// Detect Pop-out Mode
function detectPopoutMode() {
    const wasPopout = isPopoutMode;
    isPopoutMode = window.innerWidth > POPOUT_WIDTH_THRESHOLD || window.parent === window;

    if (isPopoutMode !== wasPopout) {
        document.getElementById('app').classList.toggle('is-popout', isPopoutMode);
        console.log(`[Layout] Mode: ${isPopoutMode ? 'Pop-out' : 'Panel'}`);

        if (isPopoutMode) {
            // Only broadcaster can edit layout
            if (isBroadcaster()) {
                injectEditModeButton();
            }
            loadLayoutOrder();

            // Auto-Resize Pop-out Window (Best Effort)
            try {
                if (window.outerWidth < 1000) {
                    window.resizeTo(1280, 800);
                    console.log('[Layout] Attempted auto-resize to 1280x800');

                    // Fallback: If resize fails (likely), show a toast
                    setTimeout(() => {
                        if (window.outerWidth < 1000) {
                            showResizeToast();
                        }
                    }, 1000);
                }
            } catch (e) {
                console.warn('[Layout] Auto-resize blocked by browser:', e);
            }
        }
    }
}

// Show Resize Toast
function showResizeToast() {
    if (document.getElementById('resize-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'resize-toast';
    toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: var(--glass-surface); border: 1px solid var(--accent-teal);
        color: white; padding: 10px 20px; border-radius: 50px;
        box-shadow: 0 0 20px rgba(0,0,0,0.5); z-index: 2000;
        font-family: 'Inter', sans-serif; font-size: 0.9rem;
        display: flex; align-items: center; gap: 10px;
        animation: slideUp 0.5s ease-out;
    `;
    toast.innerHTML = `<span>↔️ Resize window for best experience!</span>`;
    document.body.appendChild(toast);

    // Auto remove after 5s or when resized
    setTimeout(() => toast.remove(), 8000);
    window.addEventListener('resize', () => {
        if (window.outerWidth > 1000) toast.remove();
    });
}

// Check if current user is broadcaster
function isBroadcaster() {
    // Debug Override
    const params = new URLSearchParams(window.location.search);
    if (params.has('edit')) return true;

    if (!twitch) return true; // Dev mode

    console.log('[Layout] Checking role:', twitch.viewer ? twitch.viewer.role : 'No viewer object');
    return twitch.viewer && twitch.viewer.role === 'broadcaster';
}

// Inject Edit Mode Toggle Button (Broadcaster Only)
function injectEditModeButton() {
    if (document.getElementById('btn-edit-mode')) return;

    const btn = document.createElement('button');
    btn.id = 'btn-edit-mode';
    btn.className = 'edit-mode-btn';
    btn.innerHTML = '✏️ Edit Layout';
    btn.addEventListener('click', toggleEditMode);
    document.body.appendChild(btn);
}

// Toggle Edit Mode
function toggleEditMode() {
    isEditMode = !isEditMode;
    document.getElementById('app').classList.toggle('is-edit-mode', isEditMode);
    document.getElementById('btn-edit-mode').classList.toggle('active', isEditMode);
    document.getElementById('btn-edit-mode').innerHTML = isEditMode ? '✓ Done' : '✏️ Edit Layout';

    if (isEditMode) {
        enableDragDrop();
    } else {
        disableDragDrop();
        saveLayoutOrder();
    }
}

// Enable Drag & Drop
// Enable Drag & Drop (Advanced Grid Builder)
function enableDragDrop() {
    const pads = document.querySelectorAll('#dynamic-triggers .pad');

    // Add resize handles if missing
    pads.forEach(pad => {
        if (!pad.querySelector('.resize-handle')) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            handle.addEventListener('mousedown', initResize);
            pad.appendChild(handle);
        }

        // Use native mouse listeners for smoother "Absolute" dragging
        pad.addEventListener('mousedown', initDrag);
    });
}

// Disable Drag & Drop
function disableDragDrop() {
    const pads = document.querySelectorAll('#dynamic-triggers .pad');
    pads.forEach(pad => {
        pad.removeEventListener('mousedown', initDrag);
        // We keep resize handles but they are hidden via CSS
    });
}

// --- Interaction State ---
let activeIteraction = null; // { type: 'drag'|'resize', el, startX, startY, startGrid: {x,y,w,h} }

// Grid Constants
const GRID_COLS = 12;
const GRID_ROW_HEIGHT = 60; // px
const GRID_GAP = 10;
// We calculate col width dynamically based on container

function getGridMetrics() {
    const container = document.getElementById('dynamic-triggers');
    const width = container.clientWidth;
    // (width - (11 * gap)) / 12
    const colWidth = (width - ((GRID_COLS - 1) * GRID_GAP)) / GRID_COLS;
    return { colWidth, rowHeight: GRID_ROW_HEIGHT, gap: GRID_GAP };
}

// --- Drag Logic ---
function initDrag(e) {
    if (e.target.classList.contains('resize-handle')) return; // Pass to resize
    if (!isEditMode) return;

    e.preventDefault();
    const el = e.currentTarget;
    const computed = window.getComputedStyle(el);

    activeIteraction = {
        type: 'drag',
        el: el,
        startX: e.clientX,
        startY: e.clientY,
        startGrid: {
            x: parseInt(computed.gridColumnStart) || 'auto',
            y: parseInt(computed.gridRowStart) || 'auto'
        }
    };

    el.classList.add('is-dragging');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
}

// --- Resize Logic ---
function initResize(e) {
    if (!isEditMode) return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.target.parentElement;
    const computed = window.getComputedStyle(el);
    const spanCol = computed.gridColumnEnd.replace('span', '').trim();
    const spanRow = computed.gridRowEnd.replace('span', '').trim();

    activeIteraction = {
        type: 'resize',
        el: el,
        startX: e.clientX,
        startY: e.clientY,
        startGrid: {
            w: parseInt(spanCol) || 1,
            h: parseInt(spanRow) || 1
        }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
}

function onMove(e) {
    if (!activeIteraction) return;
    const metrics = getGridMetrics();
    const deltaX = e.clientX - activeIteraction.startX;
    const deltaY = e.clientY - activeIteraction.startY;

    if (activeIteraction.type === 'drag') {
        // Visual feedback only (transform)
        activeIteraction.el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    } else if (activeIteraction.type === 'resize') {
        const deltaCols = Math.round(deltaX / (metrics.colWidth + metrics.gap));
        const deltaRows = Math.round(deltaY / (metrics.rowHeight + metrics.gap));

        const newW = Math.max(1, Math.min(12, activeIteraction.startGrid.w + deltaCols));
        const newH = Math.max(1, Math.min(12, activeIteraction.startGrid.h + deltaRows));

        activeIteraction.el.style.gridColumnEnd = `span ${newW}`;
        activeIteraction.el.style.gridRowEnd = `span ${newH}`;
    }
}

function onEnd(e) {
    if (!activeIteraction) return;

    const metrics = getGridMetrics();
    const deltaX = e.clientX - activeIteraction.startX;
    const deltaY = e.clientY - activeIteraction.startY;

    if (activeIteraction.type === 'drag') {
        // Snap to grid
        const colsMoved = Math.round(deltaX / (metrics.colWidth + metrics.gap));
        const rowsMoved = Math.round(deltaY / (metrics.rowHeight + metrics.gap));

        // Simply update grid position (allow overlap for now - pure manual control)
        // If current is 'auto', assume 1
        let currentX = activeIteraction.startGrid.x === 'auto' ? 1 : activeIteraction.startGrid.x;
        let currentY = activeIteraction.startGrid.y === 'auto' ? 1 : activeIteraction.startGrid.y;

        let newX = Math.max(1, Math.min(13, currentX + colsMoved)); // 1-13
        let newY = Math.max(1, currentY + rowsMoved);

        activeIteraction.el.style.gridColumnStart = newX;
        activeIteraction.el.style.gridRowStart = newY;

        // Reset transform
        activeIteraction.el.classList.remove('is-dragging');
        activeIteraction.el.style.transform = '';
    }

    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onEnd);
    activeIteraction = null;
}

// Save Layout MAP to Twitch Broadcaster Config
function saveLayoutOrder() {
    const pads = document.querySelectorAll('#dynamic-triggers .pad');
    const layoutMap = {};

    pads.forEach(pad => {
        const style = window.getComputedStyle(pad);
        // Only save if explicitly set
        if (pad.style.gridColumnStart || pad.style.gridRowStart) {
            layoutMap[pad.dataset.id] = {
                x: parseInt(pad.style.gridColumnStart) || undefined,
                y: parseInt(pad.style.gridRowStart) || undefined,
                w: parseInt(pad.style.gridColumnEnd.replace('span', '')) || undefined,
                h: parseInt(pad.style.gridRowEnd.replace('span', '')) || undefined
            };
        }
    });

    if (twitch && twitch.configuration && twitch.configuration.set) {
        let config = {};
        try {
            if (twitch.configuration.broadcaster && twitch.configuration.broadcaster.content) {
                config = JSON.parse(twitch.configuration.broadcaster.content);
            }
        } catch (e) { }

        config.layoutMap = layoutMap; // New Key
        delete config.layoutOrder;    // Cleanup old key

        twitch.configuration.set('broadcaster', '1.0', JSON.stringify(config));
        console.log('[Layout] Saved Map to Config:', layoutMap);
    } else {
        localStorage.setItem('trigger_layout_map', JSON.stringify(layoutMap));
        console.log('[Layout] Saved Map to localStorage:', layoutMap);
    }
}

// Load Layout MAP
function loadLayoutOrder() {
    let layoutMap = null;

    // 1. Try Twitch
    if (twitch && twitch.configuration && twitch.configuration.broadcaster) {
        try {
            const config = JSON.parse(twitch.configuration.broadcaster.content);
            if (config.layoutMap) layoutMap = config.layoutMap;
        } catch (e) { }
    }

    // 2. Try LocalStorage
    if (!layoutMap) {
        try {
            layoutMap = JSON.parse(localStorage.getItem('trigger_layout_map'));
        } catch (e) { }
    }

    if (!layoutMap) return;

    console.log('[Layout] Applying Map:', layoutMap);
    const pads = document.querySelectorAll('#dynamic-triggers .pad');

    pads.forEach(pad => {
        const props = layoutMap[pad.dataset.id];
        if (props) {
            if (props.x) pad.style.gridColumnStart = props.x;
            if (props.y) pad.style.gridRowStart = props.y;
            if (props.w) pad.style.gridColumnEnd = `span ${props.w}`;
            if (props.h) pad.style.gridRowEnd = `span ${props.h}`;
        }
    });
}

// Initialize on load
window.addEventListener('resize', detectPopoutMode);
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(detectPopoutMode, 500); // Delay to ensure DOM is ready
});

