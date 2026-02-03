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

        this.ws.onopen = () => {
            console.log("[VDO] Signaling connected.");
            this.emit('join', this.roomID);
        };

        this.ws.onmessage = (e) => {
            const data = e.data;
            if (data === '2') { this.ws.send('3'); return; } // Ping/Pong

            if (data.startsWith('42')) {
                try {
                    const [event, payload] = JSON.parse(data.substring(2));
                    if (event === 'signal') this.handleSignal(payload.msg);
                } catch (err) { console.warn("[VDO] Failed to parse signaling message:", err); }
            }
        };

        this.ws.onerror = (e) => console.error("[VDO] Signaling error:", e);
        this.ws.onclose = () => console.warn("[VDO] Signaling closed.");
    }

    emit(event, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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

        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.emit('signal', { room: this.roomID, msg: event.candidate });
            }
        };

        this.pc.ontrack = (event) => {
            console.log("[VDO] Received track:", event.streams[0]);
            if (this.audioElement) {
                this.audioElement.srcObject = event.streams[0];
                this.audioElement.play().catch(err => {
                    console.warn("[VDO] Autoplay blocked, needs user interaction:", err);
                });
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("[VDO] Connection state:", this.pc.connectionState);
        };
    }
}

// Global instance for viewer.js to use
window.vdoReceiver = null;
