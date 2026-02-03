/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
 * Version 11: "Raw Ninja" Protocol over Native WebSockets.
 * 🚀 Protocol-matched for VDO.Ninja native host-side signaling.
 */

class VdoReceiver {
    constructor(signalingUrl, roomID) {
        this.signalingUrl = signalingUrl;
        this.roomID = roomID;
        this.pc = null;
        this.audioElement = null;
        this.ws = null;
        this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    async start(targetElementId) {
        console.log("[VDO-V11] Starting Raw-WS Receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);
        await this.setupPeerConnection();

        // Connect via Raw WebSocket (Bypasses Socket.io)
        const wsUrl = `wss://${this.signalingUrl}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log("[VDO-V11] WebSocket Connected. Joining Room...");
            // VDO.Ninja Native Join Packet
            this.send({ room: this.roomID, request: "join" });

            // Force offer request immediately
            console.log("[VDO-V11] Prompting host for offer...");
            this.send({ room: this.roomID, msg: { type: "request-offer" } });
        };

        this.ws.onmessage = (e) => {
            const now = new Date().toLocaleTimeString();
            try {
                const data = JSON.parse(e.data);
                console.log(`[VDO-V11-In] [${now}]`, data);

                // Handle VDO.Ninja Signal Format
                if (data.msg) {
                    this.handleSignal(data.msg, data.from);
                } else if (data.type === 'offer' || data.type === 'candidate') {
                    this.handleSignal(data, data.from);
                }
            } catch (err) {
                console.warn("[VDO-V11] Received non-JSON or invalid data:", e.data);
            }
        };

        this.ws.onerror = (e) => console.error("[VDO-V11] WS Error:", e);
        this.ws.onclose = () => console.warn("[VDO-V11] WS Closed.");

        // Diagnostic Heartbeat
        setInterval(() => {
            const pcState = this.pc ? this.pc.connectionState : 'NONE';
            if (this.ws.readyState === WebSocket.OPEN && pcState === 'new') {
                console.log("[VDO-V11-Diag] PC Still 'new' - re-sending join...");
                this.send({ room: this.roomID, request: "join" });
                this.send({ room: this.roomID, msg: { type: "request-offer" } });
            }
        }, 10000);
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[VDO-V11-Out] Sending:", obj);
            this.ws.send(JSON.stringify(obj));
        }
    }

    async handleSignal(msg, fromSender) {
        if (!msg || !msg.type) return;
        console.log(`[VDO-V11-Signal] Type: ${msg.type} From: ${fromSender || 'unknown'}`);

        if (msg.type === 'offer') {
            console.log("[VDO-V11] Received offer, creating answer...");
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.send({ room: this.roomID, msg: answer, to: fromSender });
        } else if (msg.type === 'candidate' || msg.candidate) {
            try { await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate || msg)); } catch (e) { }
        }
    }

    async setupPeerConnection() {
        if (this.pc) return;
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) this.send({ room: this.roomID, msg: event.candidate });
        };

        this.pc.ontrack = (event) => {
            console.log("[VDO-V11-Track-In] Media Track received!", event.streams[0]);
            if (this.audioElement) {
                this.audioElement.srcObject = event.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    this.audioElement.play().catch(err => console.warn("[VDO] Playback failed", err));
                    this.setupAudioAnalysis(event.streams[0]);
                };
            }
        };

        this.pc.onconnectionstatechange = () => console.log("[VDO-V11-PC-State]", this.pc.connectionState);
    }

    setupAudioAnalysis(stream) {
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
                if (meterBar) meterBar.style.width = Math.min(100, ((sum / bufferLength) / 32) * 100) + '%';
                requestAnimationFrame(update);
            };
            update();
        } catch (e) { }
    }
}

window.vdoReceiver = null;
