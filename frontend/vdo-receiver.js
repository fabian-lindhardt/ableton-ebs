/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
 * Version 10: "Universal Handshake" with Aggressive Relay & DISTINCT LOGGING.
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
        console.log("[VDO-V10-ULTRA] Starting Universal Receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);
        await this.setupPeerConnection();

        // Setup Signaling (Minimal Socket.io emulation)
        const wsUrl = `wss://${this.signalingUrl}/socket.io/?EIO=4&transport=websocket`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = (e) => {
            const now = new Date().toLocaleTimeString();
            const data = e.data;
            if (!data.startsWith('42')) console.log(`[VDO-Raw-In] [${now}]`, data);

            if (data.startsWith('0')) {
                this.ws.send('40');
            } else if (data === '2') {
                this.ws.send('3');
            } else if (data.startsWith('40')) {
                console.log("[VDO-V10-ULTRA] Connected! Handshaking with Universal Relay Protocol...");

                // Variation 1: Simple join for our upgraded relay
                this.emit('join', this.roomID);

                // Variation 2: VDO-Native join-room
                setTimeout(() => {
                    this.emit('join-room', {
                        room: this.roomID,
                        view: this.roomID,
                        role: 'viewer',
                        jid: 'vdo_' + Math.random().toString(36).substring(7)
                    });
                }, 500);

                // Variation 3: Explicit 'request-offer' signal
                setTimeout(() => {
                    console.log("[VDO-V10-ULTRA] Broadcasting request-offer...");
                    this.emit('signal', { type: 'request-offer', room: this.roomID });
                }, 1000);

            } else if (data.startsWith('42')) {
                try {
                    const parsed = JSON.parse(data.substring(2));
                    const event = parsed[0];
                    const payload = parsed[1];
                    console.log(`[VDO-Event-In] [${now}] ${event}:`, payload);

                    if (event === 'signal') {
                        const signalMsg = (payload && payload.msg) ? payload.msg : payload;
                        if (signalMsg && signalMsg.type) this.handleSignal(signalMsg, payload.from);
                    } else if (event === 'ready' || event === 'peer-joined' || event === 'joined') {
                        console.log("[VDO-V10-ULTRA] Peer/Room confirmed! Forcing offer request...");
                        this.emit('signal', { type: 'request-offer', room: this.roomID });
                    }
                } catch (err) { }
            }
        };

        this.ws.onopen = () => console.log("[VDO-V10-ULTRA] WebSocket connected. Handshaking...");
        this.ws.onclose = () => console.warn("[VDO-V10-ULTRA] Signaling closed.");

        setInterval(() => {
            const wsState = this.ws ? (['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState]) : 'NONE';
            const pcState = this.pc ? this.pc.connectionState : 'NONE';
            const hasTrack = !!(this.audioElement && this.audioElement.srcObject);
            const now = new Date().toLocaleTimeString();
            console.log(`[VDO-Diag-V10] [${now}] WS: ${wsState}, PC: ${pcState}, Track: ${hasTrack}`);

            if (wsState === 'OPEN' && pcState === 'new') {
                this.emit('signal', { type: 'request-offer', room: this.roomID });
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
        }, 10000);
    }

    emit(event, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('42' + JSON.stringify([event, data]));
        }
    }

    async handleSignal(msg, fromSender) {
        if (!msg || !msg.type) return;
        console.log(`[VDO-Signal-Handle] Type: ${msg.type} From: ${fromSender || 'unknown'}`);

        if (msg.type === 'offer') {
            console.log("[VDO-V10-ULTRA] Received offer, creating answer...");
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            const reply = { room: this.roomID, msg: answer };
            if (fromSender) reply.to = fromSender;
            this.emit('signal', reply);
        } else if (msg.candidate || msg.type === 'candidate') {
            try { this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate || msg)); } catch (e) { }
        }
    }

    async setupPeerConnection() {
        if (this.pc) return;
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) this.emit('signal', { room: this.roomID, msg: event.candidate });
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

        this.pc.onconnectionstatechange = () => console.log("[VDO-PC-State]", this.pc.connectionState);
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
        } catch (e) { }
    }
}

window.vdoReceiver = null;
