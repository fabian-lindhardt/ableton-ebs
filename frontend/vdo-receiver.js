/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
 * Version 8: "Broadcast Relay" Protocol for Minimal Signaling Servers.
 * 🚀 Fixed to support custom Socket.io relay found in k8s manifests.
 */

class VdoReceiver {
    constructor(signalingUrl, roomID) {
        this.signalingUrl = signalingUrl;
        this.roomID = roomID;
        this.pc = null;
        this.audioElement = null;
        this.ws = null;
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
    }

    async start(targetElementId) {
        console.log("[VDO] Starting Broadcast Receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);

        // Initialize PC immediately
        await this.setupPeerConnection();

        // Setup Signaling (Minimal Socket.io emulation)
        const wsUrl = `wss://${this.signalingUrl}/socket.io/?EIO=4&transport=websocket`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = (e) => {
            const now = new Date().toLocaleTimeString();
            const data = e.data;

            // Log raw traffic for handshake debugging
            if (!data.startsWith('42')) {
                console.log(`[VDO-Raw-In] [${now}]`, data);
            }

            if (data.startsWith('0')) { // Engine.io OPEN
                this.ws.send('40'); // Socket.io Connect (Root Namespace)
            } else if (data === '2') { // Ping
                this.ws.send('3'); // Pong
            } else if (data.startsWith('40')) { // Socket.io CONNECTED
                console.log("[VDO] Connected! Handshaking with Minimal Relay Protocol...");

                // 1. Mandatory JOIN (Simple string as expected by the custom server)
                this.emit('join', this.roomID);

                // 2. Wrap join behavior into a SIGNAL broadcast (Targeting the Host/Publisher)
                // The custom server will 'broadcast' this to everyone else in the room.
                setTimeout(() => {
                    console.log("[VDO] Broadcasting 'request-offer' signal...");
                    this.emit('signal', {
                        type: 'request-offer',
                        room: this.roomID,
                        view: this.roomID
                    });
                }, 1000);

                // 3. Fallback: Generic 'message' relay (broadcasted by server)
                setTimeout(() => {
                    this.emit('message', { event: 'join-room', room: this.roomID });
                }, 2000);

            } else if (data.startsWith('42')) { // Socket.io MESSAGE
                try {
                    const parsed = JSON.parse(data.substring(2));
                    const event = parsed[0];
                    const payload = parsed[1];
                    console.log(`[VDO-Event-In] [${now}] ${event}:`, payload);

                    if (event === 'signal') {
                        // In the custom relay, the payload might have 'from' added by the server
                        // We extract the underlying WebRTC message (usually 'msg' in VDO)
                        const signalMsg = (payload && payload.msg) ? payload.msg : payload;
                        if (signalMsg && signalMsg.type) this.handleSignal(signalMsg, payload.from);
                    } else if (event === 'joined' || event === 'peer-joined') {
                        console.log("[VDO] Peer confirmed! Re-broadcasting offer request...");
                        this.emit('signal', { type: 'request-offer', room: this.roomID });
                    }
                } catch (err) {
                    console.warn("[VDO] Failed to parse message:", err, data);
                }
            }
        };

        this.ws.onopen = () => console.log("[VDO] WebSocket connected. Handshaking...");
        this.ws.onerror = (e) => console.error("[VDO] Signaling error:", e);
        this.ws.onclose = () => console.warn("[VDO] Signaling closed.");

        // Diagnostic heartbeat (every 10s)
        setInterval(() => {
            const wsState = this.ws ? (['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState]) : 'NONE';
            const pcState = this.pc ? this.pc.connectionState : 'NONE';
            const hasTrack = !!(this.audioElement && this.audioElement.srcObject);
            const now = new Date().toLocaleTimeString();
            console.log(`[VDO-Diag] [${now}] WS: ${wsState}, PC: ${pcState}, Track: ${hasTrack}`);

            if (wsState === 'OPEN' && pcState === 'new') {
                console.log("[VDO-Diag] Still 'new' - re-broadcasting request-offer...");
                this.emit('signal', { type: 'request-offer', room: this.roomID });
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
        }, 10000);
    }

    emit(event, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const msg = '42' + JSON.stringify([event, data]);
            console.log("[VDO-Event-Out] Sending:", event, data);
            this.ws.send(msg);
        }
    }

    async handleSignal(msg, fromSender) {
        if (!msg || !msg.type) return;
        console.log(`[VDO-Signal-Handle] Type: ${msg.type} From: ${fromSender || 'unknown'}`);

        if (msg.type === 'offer') {
            console.log("[VDO] Received offer, creating answer...");
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);

            // Send back the answer via 'signal' relay
            const reply = { room: this.roomID, msg: answer };
            if (fromSender) reply.to = fromSender; // Direct reply if we have the ID
            this.emit('signal', reply);

        } else if (msg.candidate || (msg.type === 'candidate')) {
            try {
                const cand = msg.candidate ? msg.candidate : msg;
                await this.pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) { /* ignore cleanup errors */ }
        }
    }

    async setupPeerConnection() {
        if (this.pc) return;
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("[VDO-ICE-Out]", event.candidate.candidate.substring(0, 30) + "...");
                this.emit('signal', { room: this.roomID, msg: event.candidate });
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            console.log("[VDO-ICE-State]", this.pc.iceConnectionState);
        };

        this.pc.ontrack = (event) => {
            console.log("[VDO-Track-In] Media Track received!", event.streams[0]);
            if (this.audioElement) {
                this.audioElement.srcObject = event.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    this.audioElement.play().catch(err => console.warn("[VDO] Autoplay blocked", err));
                    this.setupAudioAnalysis(event.streams[0]);
                };
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("[VDO-PC-State]", this.pc.connectionState);
        };
    }

    setupAudioAnalysis(stream) {
        console.log("[VDO] Setting up audio analysis...");
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioCtx.createMediaStreamSource(stream);
            const analyser = this.audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            const meterBar = document.getElementById('vdo-meter-bar');

            const update = () => {
                if (this.audioCtx.state === 'suspended') { requestAnimationFrame(update); return; }
                analyser.getByteFrequencyData(dataArray);
                let sum = 0; for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
                const percent = Math.min(100, ((sum / bufferLength) / 32) * 100);
                if (meterBar) {
                    meterBar.style.width = percent + '%';
                    meterBar.style.background = percent > 85 ? 'var(--accent-pink)' : 'linear-gradient(90deg, var(--accent-teal), #fff)';
                }
                requestAnimationFrame(update);
            };
            update();
        } catch (e) { console.warn("[VDO] Audio analysis failed:", e); }
    }
}

window.vdoReceiver = null;
