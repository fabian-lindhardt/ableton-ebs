/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
 * Version 7: "Kitchen Sink" Join Sequence & Role Diagnostics
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
        console.log("[VDO] Starting direct receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);
        if (!this.audioElement) {
            console.error("[VDO] Audio element not found:", targetElementId);
            return;
        }

        // Initialize PC immediately
        await this.setupPeerConnection();

        // Setup Signaling (Minimal Socket.io emulation)
        const wsUrl = `wss://${this.signalingUrl}/socket.io/?EIO=4&transport=websocket`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = (e) => {
            const now = new Date().toLocaleTimeString();
            const data = e.data;

            // Log ALL raw traffic for handshake debugging
            if (!data.startsWith('42')) {
                console.log(`[VDO-Raw-In] [${now}]`, data);
            }

            if (data.startsWith('0')) { // Engine.io OPEN
                this.ws.send('40'); // Socket.io Connect (Root Namespace)
            } else if (data === '2') { // Ping
                this.ws.send('3'); // Pong
            } else if (data.startsWith('40')) { // Socket.io CONNECTED
                console.log("[VDO] Connected! Executing 'Kitchen Sink' Join Sequence...");
                const jid = "vdo_" + Math.random().toString(36).substring(7);
                const uid = Date.now().toString(36); // Unique ID for some protocol variants

                // Variation 1: VDO.Ninja Specific "join-room" (Object)
                this.emit('join-room', { room: this.roomID, view: this.roomID, jid: jid, id: uid, role: 'viewer' });

                // Variation 2: Pure "join" (String) - Most common for older protocols
                setTimeout(() => this.emit('join', this.roomID), 200);

                // Variation 3: Pure "join" (Object)
                setTimeout(() => this.emit('join', { room: this.roomID, jid: jid, role: 'viewer' }), 400);

                // Variation 4: "room" (String) - Used in some Electron implementations
                setTimeout(() => this.emit('room', this.roomID), 600);

                // Variation 5: "check-in" (Common for tracker-based VDO)
                setTimeout(() => this.emit('check-in', { room: this.roomID, id: jid }), 800);

                // Variation 6: "request-offer" (Force a prompt)
                setTimeout(() => this.emit('request-offer', { room: this.roomID, view: this.roomID }), 1200);

                // Variation 7: "add-peer" (Used in some mesh variants)
                setTimeout(() => this.emit('add-peer', { room: this.roomID, role: 'viewer' }), 1500);

            } else if (data.startsWith('42')) { // Socket.io MESSAGE
                try {
                    const parsed = JSON.parse(data.substring(2));
                    const event = parsed[0];
                    const payload = parsed[1];
                    console.log(`[VDO-Event-In] [${now}] ${event}:`, payload);

                    if (event === 'signal') {
                        const signalMsg = (payload && payload.msg) ? payload.msg : payload;
                        if (signalMsg) this.handleSignal(signalMsg);
                    } else if (event === 'ready' || event === 'peer-joined' || event === 'joined') {
                        console.log("[VDO] Peer/Room confirmed ready! Requesting offer...");
                        this.emit('request-offer', { room: this.roomID, view: this.roomID });
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
                console.log("[VDO-Diag] Still 'new' - re-prompting host for offer...");
                this.emit('request-offer', { room: this.roomID, view: this.roomID });
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

    async handleSignal(msg) {
        if (!msg) return;
        console.log("[VDO-Signal-Handle] Type:", msg.type || (msg.candidate ? 'candidate' : 'unknown'));

        if (msg.type === 'offer') {
            console.log("[VDO] Received offer, creating answer...");
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.emit('signal', { room: this.roomID, msg: answer });
        } else if (msg.candidate) {
            try {
                await this.pc.addIceCandidate(new RTCIceCandidate(msg));
            } catch (e) { console.warn("[VDO] Error adding candidate:", e); }
        }
    }

    async setupPeerConnection() {
        if (this.pc) return;

        console.log("[VDO] Initializing PeerConnection...");
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
                console.log("[VDO] Binding track to audio element...");
                this.audioElement.srcObject = event.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    console.log("[VDO] Audio metadata loaded, starting playback...");
                    this.audioElement.play().catch(err => {
                        console.warn("[VDO] Autoplay failed - click Join Audio again:", err);
                    });
                    this.setupAudioAnalysis(event.streams[0]);
                };
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("[VDO-PC-State]", this.pc.connectionState);
            if (this.pc.connectionState === 'failed') {
                console.error("[VDO] WebRTC Connection Failed.");
            }
        };
    }

    setupAudioAnalysis(stream) {
        console.log("[VDO] Setting up audio analysis...");
        try {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const source = this.audioCtx.createMediaStreamSource(stream);
            const analyser = this.audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            const meterBar = document.getElementById('vdo-meter-bar');

            const update = () => {
                if (this.audioCtx.state === 'suspended') {
                    requestAnimationFrame(update);
                    return;
                }
                analyser.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;
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

window.vdoReceiver = null;
