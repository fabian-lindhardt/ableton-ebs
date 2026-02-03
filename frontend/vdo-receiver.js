/**
 * Custom WebRTC Audio Receiver for Twitch Extensions
 * Solution C: "Clean Slate" Custom Protocol
 * Expects a simple JSON Signaling Server (SimpleRelay).
 */

class AudioReceiver {
    constructor(signalingUrl, roomID) {
        this.signalingUrl = signalingUrl;
        this.roomID = roomID;
        this.pc = null;
        this.audioElement = null;
        this.ws = null;
        this.myId = 'viewer-' + Math.random().toString(36).substr(2, 6);
        this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    async start(targetElementId) {
        console.log(`[AudioReceiver] Starting. ID: ${this.myId}`);
        this.audioElement = document.getElementById(targetElementId);

        // Connect to SimpleRelay
        // Ingress maps /ws -> Generic Relay
        this.ws = new WebSocket(`wss://${this.signalingUrl}/ws`);

        this.ws.onopen = () => {
            console.log("[AudioReceiver] WS Connected.");
            this.send({ type: 'join', room: this.roomID, role: 'viewer', sender: this.myId });

            // Announce readiness to potential hosts
            this.send({ type: 'viewer-ready', room: this.roomID, sender: this.myId });
        };

        this.ws.onmessage = async (e) => {
            try {
                const msg = JSON.parse(e.data);

                // Filter messages not meant for us (if targeted)
                if (msg.target && msg.target !== this.myId) return;

                if (msg.type === 'offer') {
                    console.log("[AudioReceiver] Received Offer!");
                    await this.handleOffer(msg.sdp, msg.sender); // msg.sender is host ID
                } else if (msg.type === 'candidate') {
                    if (this.pc) this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                }
            } catch (err) { console.error("Msg Error", err); }
        };

        this.ws.onclose = () => console.log("[AudioReceiver] WS Closed.");

        // Heartbeat / Keepalive
        setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) this.send({ type: 'ping' });
        }, 10000);
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    async handleOffer(sdp, hostId) {
        if (this.pc) this.pc.close();
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.send({ type: 'candidate', candidate: e.candidate, target: hostId, room: this.roomID, sender: this.myId });
            }
        };

        this.pc.ontrack = (e) => {
            console.log("[AudioReceiver] 🎵 Audio Track Received!");
            if (this.audioElement) {
                this.audioElement.srcObject = e.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    this.audioElement.play().catch(e => console.error("Play failed", e));
                    this.setupAudioAnalysis(e.streams[0]);
                };
            }
        };

        this.pc.onconnectionstatechange = () => console.log(`[AudioReceiver] PC State: ${this.pc.connectionState}`);

        await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.send({ type: 'answer', sdp: answer, target: hostId, room: this.roomID, sender: this.myId });
    }

    setupAudioAnalysis(stream) {
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioCtx.createMediaStreamSource(stream);
            const analyser = this.audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const meterBar = document.getElementById('vdo-meter-bar');
            const update = () => {
                if (this.audioCtx.state === 'suspended') { requestAnimationFrame(update); return; }
                analyser.getByteFrequencyData(dataArray);
                let sum = 0; for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                if (meterBar) meterBar.style.width = Math.min(100, ((sum / dataArray.length) / 32) * 100) + '%';
                requestAnimationFrame(update);
            };
            update();
        } catch (e) { }
    }
}

// Expose global init function
window.vdoReceiver = new AudioReceiver('vdo.flairtec.de', 'bhpkXZU'); // Hardcoded MVP
