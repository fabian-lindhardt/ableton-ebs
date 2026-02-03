/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
 * Version 14: "Raw Ninja" Protocol for Native WebSocket Relay.
 * 🚀 Fixed for VDO.Ninja Native Frontend Compatibility.
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
        console.log("[VDO-V14] Starting Raw-WS Receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);
        await this.setupPeerConnection();

        // Connect via Raw WebSocket (Matches VDO.Ninja Native)
        // Note: ingress maps /ws to the relay
        const wsUrl = `wss://${this.signalingUrl}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log("[VDO-V14] WS Connected. Joining Room...");

            // VDO.Ninja Native Join Protocol imitation
            // We just blast "join" requests since our relay is dumb/transparent
            this.send({ request: "join", room: this.roomID, userid: "TwitchViewer-" + Math.random().toString(36).substr(2, 5) });
            this.send({ request: "joinroom", room: this.roomID });

            // Force offer request immediately
            console.log("[VDO-V14] Prompting host for offer...");
            this.send({ room: this.roomID, msg: { type: "request-offer" } });
        };

        this.ws.onmessage = (e) => {
            try {
                // Relay sends raw JSON strings
                const data = JSON.parse(e.data);

                // Filter out our own messages (though relay should prevent echo)
                // Filter out empty pings/pongs if any

                // Diagnostic Log
                // const now = new Date().toLocaleTimeString();
                // console.log(`[VDO-V14-In] [${now}]`, data);

                // Handle VDO.Ninja Signal Format
                // Host often sends { "msg": { "type": "offer", ... } }
                // or { "type": "offer", ... } depending on version.

                let signal = null;
                if (data.msg) signal = data.msg;
                else if (data.type) signal = data;

                if (signal) {
                    this.handleSignal(signal, data.from || data.sender);
                }

                // VDO "seed" or "handshake" implies readiness
                if (data.request === 'seed') {
                    this.send({ room: this.roomID, msg: { type: "request-offer" } });
                }

            } catch (err) {
                // Ignore non-JSON (pings etc)
            }
        };

        this.ws.onerror = (e) => console.error("[VDO-V14] WS Error:", e);
        this.ws.onclose = () => console.warn("[VDO-V14] WS Closed.");

        // Diagnostic Heartbeat
        setInterval(() => {
            const pcState = this.pc ? this.pc.connectionState : 'NONE';
            const wsState = this.ws ? (['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState]) : 'NONE';
            const now = new Date().toLocaleTimeString();
            console.log(`[VDO-Diag-V14] [${now}] WS: ${wsState}, PC: ${pcState}`);

            if (this.ws && this.ws.readyState === WebSocket.OPEN && pcState === 'new') {
                // console.log("[VDO-V14] Re-sending join...");
                // this.send({ request: "join", room: this.roomID });
                this.send({ room: this.roomID, msg: { type: "request-offer" } });
            }
            // Keep AudioContext alive
            if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
        }, 5000); // 5s aggressive heartbeat
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            // console.log("[VDO-V14-Out] Sending:", obj);
            this.ws.send(JSON.stringify(obj));
        }
    }

    async handleSignal(msg, fromSender) {
        if (!msg || !msg.type) return;
        console.log(`[VDO-V14-Signal] Type: ${msg.type}`);

        if (msg.type === 'offer') {
            console.log("[VDO-V14] Received offer, creating answer...");
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.send({ room: this.roomID, msg: answer, target: fromSender });
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
            console.log("[VDO-V14-Track-In] Media Track received!", event.streams[0]);
            if (this.audioElement) {
                this.audioElement.srcObject = event.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    this.audioElement.play().catch(err => console.warn("[VDO] Playback failed", err));
                    this.setupAudioAnalysis(event.streams[0]);
                };
            }
        };

        this.pc.onconnectionstatechange = () => console.log("[VDO-V14-PC-State]", this.pc.connectionState);
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
