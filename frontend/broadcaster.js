const SIGNALING_URL = 'wss://vdo.flairtec.de/ws'; // Ingress maps /ws to generic relay
const ROOM_ID = 'bhpkXZU'; // Hardcoded for MVP
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let ws = null;
let pcs = new Map(); // ClientID -> RTCPeerConnection
let localStream = null;

function log(msg) {
    const box = document.getElementById('logs');
    const time = new Date().toLocaleTimeString();
    box.innerHTML += `<div>[${time}] ${msg}</div>`;
    box.scrollTop = box.scrollHeight;
    console.log(msg);
}

async function init() {
    document.getElementById('btn-start').onclick = startStreaming;
    document.getElementById('btn-refresh').onclick = refreshDevices;
    refreshDevices();
}

async function refreshDevices() {
    const selector = document.getElementById('audio-input');
    selector.innerHTML = ''; // clear
    try {
        // Force permission request to unmask labels
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop()); // close immediately

        const devices = await navigator.mediaDevices.enumerateDevices();
        devices.filter(d => d.kind === 'audioinput').forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.text = d.label || `Microphone ${selector.options.length + 1}`;
            selector.appendChild(opt);
        });
        log("✅ Devices refreshed (Permissions granted).");
    } catch (e) { log("⚠️ Device Refresh Error (Check perms): " + e); }
}

async function startStreaming() {
    const deviceId = document.getElementById('audio-input').value;
    log(`Attempting capture with ID: ${deviceId}`);
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId, // Implies "ideal", not "exact"
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
                // Removed channelCount to avoid OverconstrainedError on mono mics
            },
            video: false
        });
        log("🎤 Audio captured successfully!");
        document.getElementById('btn-start').disabled = true;
        connectSignaling();
    } catch (e) {
        log("❌ Capture failed: " + e.name + ": " + e.message);
        console.error(e);
    }
}

function connectSignaling() {
    ws = new WebSocket(SIGNALING_URL);

    ws.onopen = () => {
        document.getElementById('ws-status').textContent = 'CONNECTED';
        document.getElementById('ws-status').className = 'connected';
        document.getElementById('room-id').textContent = ROOM_ID;
        log("📡 WS Connected to " + SIGNALING_URL);

        ws.send(JSON.stringify({ type: 'join', room: ROOM_ID, role: 'host' }));
    };

    ws.onmessage = async (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'join') {
                // New viewer joined!
                log(`👋 New Viewer joined! (ID: ??)`);
                // In a perfect world we get an ID, but for broadcast we can just create a PC
                // Actually, our relay sends messages to *others*.
                // If a viewer joins, they should send a "ready" or "join" message that is forwarded here.
            }

            if (msg.type === 'viewer-ready') {
                createPeerConnection(msg.sender);
            }

            if (msg.type === 'answer') {
                handleAnswer(msg.sender, msg.sdp);
            }

            if (msg.type === 'candidate') {
                handleCandidate(msg.sender, msg.candidate);
            }

        } catch (err) { log("Msg Error: " + err); }
    };

    ws.onclose = () => {
        document.getElementById('ws-status').textContent = 'DISCONNECTED';
        document.getElementById('ws-status').className = 'disconnected';
        log("🔌 WS Disconnected. Reconnecting in 3s...");
        setTimeout(connectSignaling, 3000);
    };
}

async function createPeerConnection(viewerId) {
    if (pcs.has(viewerId)) return; // Already connected

    log(`✨ creating PC for viewer ${viewerId}`);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcs.set(viewerId, pc);

    // Add Track
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: e.candidate, target: viewerId, room: ROOM_ID }));
        }
    };

    pc.onconnectionstatechange = () => log(`PC State (${viewerId}): ${pc.connectionState}`);

    // Create Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({ type: 'offer', sdp: offer, target: viewerId, room: ROOM_ID }));
}

async function handleAnswer(viewerId, sdp) {
    const pc = pcs.get(viewerId);
    if (pc) {
        log(`📨 Received Answer from ${viewerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
}

async function handleCandidate(viewerId, candidate) {
    const pc = pcs.get(viewerId);
    if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

init();
