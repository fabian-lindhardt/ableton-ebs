/**
 * Minimal VDO.Ninja WebRTC Receiver for Twitch Extensions
 * Bypasses iFrame CSP restrictions by using direct WebRTC.
 * Version 12: "Supreme Relay" Protocol over Socket.io v4.
 * 🚀 Fully matched for VDO.Ninja native host-side signaling.
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
        console.log("[VDO-V12] Starting Supreme Receiver for room:", this.roomID);
        this.audioElement = document.getElementById(targetElementId);
        await this.setupPeerConnection();

        // Connect via Socket.io v4 Emulation
        const wsUrl = `wss://${this.signalingUrl}/socket.io/?EIO=4&transport=websocket`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onmessage = (e) => {
            const data = e.data;
            const now = new Date().toLocaleTimeString();

            if (data.startsWith('0')) {
                this.ws.send('40'); // Handshake ack
            } else if (data === '2') {
                this.ws.send('3'); // Heartbeat
            } else if (data.startsWith('40')) {
                console.log("[VDO-V12] Connected! Joining Room...");
                this.emit('join', this.roomID);
                this.emit('join-room', { room: this.roomID, role: 'viewer' });
                this.emit('signal', { type: 'request-offer', room: this.roomID });
            } else if (data.startsWith('42')) {
                try {
                    const parsed = JSON.parse(data.substring(2));
                    const [event, payload] = parsed;
                    console.log(`[VDO-V12-In] [${now}] ${event}:`, payload);

                    if (event === 'signal') {
                        const msg = payload.msg || payload;
                        if (msg && msg.type) this.handleSignal(msg, payload.from);
                    } else if (event === 'offer' || event === 'answer' || event === 'candidate') {
                        this.handleSignal(payload, payload.from);
                    } else if (event === 'ready') {
                        this.emit('signal', { type: 'request-offer', room: this.roomID });
                    }
                } catch (err) { }
            }
        };

        this.ws.onopen = () => console.log("[VDO-V12] WS Connected.");
        this.ws.onclose = () => console.warn("[VDO-V12] WS Closed.");

        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN && this.pc && this.pc.connectionState === 'new') {
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
        console.log(`[VDO-V12-Signal] Type: ${msg.type} From: ${fromSender}`);

        if (msg.type === 'offer') {
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.emit('signal', { room: this.roomID, msg: answer, to: fromSender });
        } else if (msg.type === 'candidate' || msg.candidate) {
            try { await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate || msg)); } catch (e) { }
        }
    }

    async setupPeerConnection() {
        if (this.pc) return;
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this.pc.onicecandidate = (e) => {
            if (e.candidate) this.emit('signal', { room: this.roomID, msg: e.candidate });
        };
        this.pc.ontrack = (e) => {
            console.log("[VDO-V12-Track] Media Track received!");
            if (this.audioElement) {
                this.audioElement.srcObject = e.streams[0];
                this.audioElement.onloadedmetadata = () => {
                    this.audioElement.play().catch(console.error);
                    this.setupAudioAnalysis(e.streams[0]);
                };
            }
        };
        this.pc.onconnectionstatechange = () => console.log("[VDO-V12-PC-State]", this.pc.connectionState);
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
window.vdoReceiver = null;
