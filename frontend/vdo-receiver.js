/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
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
            { urls: 'stun:vdo.flairtec.de:3478' }
        ];
    }

    async start(targetElementId) {
        console.log("[VDO] Starting direct receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);
        if (!this.audioElement) {
            console.error("[VDO] Audio element not found:", targetElementId);
            return;
        }

        // Setup Signaling (Minimal Socket.io emulation)
        const wsUrl = `wss://${this.signalingUrl}/socket.io/?EIO=4&transport=websocket`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = (e) => {
            const data = e.data;
            if (data.startsWith('0')) { // Engine.io OPEN
                this.ws.send('40'); // Socket.io Connect (Root Namespace)
            } else if (data === '2') { // Ping
                this.ws.send('3'); // Pong
            } else if (data.startsWith('40')) { // Socket.io CONNECTED
                console.log("[VDO] Protocol handshake complete. Joining room...");
                this.emit('join', { room: this.roomID });
            } else if (data.startsWith('42')) { // Socket.io MESSAGE
                try {
                    const parsed = JSON.parse(data.substring(2));
                    const event = parsed[0];
                    const payload = parsed[1];
                    console.log("[VDO] Signaling Event:", event, payload);
                    if (event === 'signal') this.handleSignal(payload.msg);
                } catch (err) { console.warn("[VDO] Failed to parse message:", err); }
            }
        };

        this.ws.onopen = () => {
            console.log("[VDO] WebSocket connected. Handshaking...");
        };

        this.ws.onerror = (e) => console.error("[VDO] Signaling error:", e);
        this.ws.onclose = () => console.warn("[VDO] Signaling closed.");

        // Diagnostic heartbeat (every 10s)
        setInterval(() => {
            const wsState = this.ws ? (['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState]) : 'NONE';
            const pcState = this.pc ? this.pc.connectionState : 'NONE';
            const iceState = this.pc ? this.pc.iceConnectionState : 'NONE';
            const hasTrack = !!(this.audioElement && this.audioElement.srcObject);
            console.log(`[VDO-Diag] WS: ${wsState}, PC: ${pcState}, ICE: ${iceState}, Track: ${hasTrack}`);
        }, 10000);
    }

    emit(event, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[VDO] Sending Event:", event, data);
            this.ws.send('42' + JSON.stringify([event, data]));
        }
    }

    async handleSignal(msg) {
        if (!msg) return;

        if (msg.type === 'offer') {
            console.log("[VDO] Received offer, creating answer...");
            await this.setupPeerConnection();
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.emit('signal', { room: this.roomID, msg: answer });
        } else if (msg.candidate) {
            if (this.pc) {
                try {
                    await this.pc.addIceCandidate(new RTCIceCandidate(msg));
                } catch (e) { console.warn("[VDO] Error adding candidate:", e); }
            }
        }
    }

    async setupPeerConnection() {
        if (this.pc) return;

        console.log("[VDO] Initializing PeerConnection...");
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("[VDO] ICE Candidate generated:", event.candidate.candidate.substring(0, 30) + "...");
                this.emit('signal', { room: this.roomID, msg: event.candidate });
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            console.log("[VDO] ICE State:", this.pc.iceConnectionState);
        };

        this.pc.ontrack = (event) => {
            console.log("[VDO] Media Track received!", event.streams[0]);
            if (this.audioElement) {
                console.log("[VDO] Binding track to audio element...");
                this.audioElement.srcObject = event.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    console.log("[VDO] Audio metadata loaded, starting playback...");
                    this.audioElement.play().catch(err => {
                        console.warn("[VDO] Autoplay failed - user must click Join Audio again:", err);
                    });
                    this.setupAudioAnalysis(event.streams[0]);
                };
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("[VDO] Connection State:", this.pc.connectionState);
            if (this.pc.connectionState === 'failed') {
                console.error("[VDO] WebRTC Connection Failed. Check STUN/TURN servers.");
            }
        };
    }

    setupAudioAnalysis(stream) {
        console.log("[VDO] Setting up audio analysis...");
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            const meterBar = document.getElementById('vdo-meter-bar');

            const update = () => {
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;
                // Sensitivity boost: scaling based on a lower threshold since Opus/WebRTC often has lower gain
                const percent = Math.min(100, (average / 32) * 100);
                if (meterBar) {
                    meterBar.style.width = percent + '%';
                    if (percent > 85) meterBar.style.background = 'var(--accent-pink)';
                    else meterBar.style.background = 'linear-gradient(90deg, var(--accent-teal), #fff)';
                }
                requestAnimationFrame(update);
            };
            update();
        } catch (e) {
            console.warn("[VDO] Audio analysis failed:", e);
        }
    }
}

// Global instance for viewer.js to use
window.vdoReceiver = null;
