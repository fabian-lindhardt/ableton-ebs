require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 8080;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('./public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
            // Force revalidation for frontend assets
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        }
    }
}));


let bridgeSocket = null;

// State Cache (Key: "ch-cc", Value: val)
const stateCache = new Map();
// Metadata Cache (Stores tracks, clips, and scenes)
let metadataCache = { tracks: [], scenes: [] };

// WebSocket handling
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Identification
            if (data.type === 'identify' && data.role === 'bridge') {
                console.log('Local Bridge connected.');
                bridgeSocket = ws;
            }

            // 1b. Bulk Sync from Bridge (Restoring state after EBS restart)
            if (data.type === 'bulk_sync') {
                console.log(`Received Bulk Sync: ${Object.keys(data.data).length} items`);
                Object.entries(data.data).forEach(([key, val]) => {
                    stateCache.set(key, val);
                });
                // We do NOT broadcast this to PubSub to avoid spamming the API limits with 100+ requests.
                // The Viewer will fetch via API separately.
            }

            // 2. Sync from Bridge (Ableton -> Extension)
            if (data.type === 'sync') {
                console.log('Received Sync:', data.data);

                // Update Cache
                const key = `${data.data.channel}-${data.data.controller}`;
                stateCache.set(key, data.data.value);

                // A: Broadcast to Twitch PubSub (for real extension users)
                await broadcastToPubSub(data);

                // B: Broadcast to all connected WebSockets (EXCEPT the bridge)
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client !== bridgeSocket) {
                        client.send(JSON.stringify(data));
                    }
                });
            }

            // 3. Metadata from Bridge (Track names/colors)
            if (data.type === 'metadata') {
                console.log('Received Metadata Update:', data.data);

                // Update Cache (New Format: { tracks: [], scenes: [] })
                if (data.data) {
                    metadataCache = data.data;
                }

                // Broadcast
                await broadcastToPubSub(data);
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client !== bridgeSocket) {
                        client.send(JSON.stringify(data));
                    }
                });
            }

        } catch (e) {
            console.error('WS Error:', e);
        }
    });

    ws.on('close', () => {
        if (ws === bridgeSocket) {
            console.log('Local Bridge disconnected.');
            bridgeSocket = null;
        }
    });
});

// Helper: Broadcast to Twitch PubSub
async function broadcastToPubSub(payload) {
    const channelId = process.env.TWITCH_CHANNEL_ID;
    const clientId = process.env.TWITCH_CLIENT_ID;

    if (!channelId || !clientId) {
        console.error('Missing TWITCH_CHANNEL_ID or TWITCH_CLIENT_ID for PubSub.');
        return;
    }

    try {
        // Create JWT for PubSub
        const token = jwt.sign({
            exp: Math.floor(Date.now() / 1000) + 60, // 60s expiration
            user_id: channelId,
            role: 'external',
            channel_id: channelId,
            pubsub_perms: {
                send: ['broadcast']
            }
        }, EXTENSION_SECRET, { algorithm: 'HS256' });

        // console.log(`[PubSub] Sending to ${channelId} with token for ${channelId}`);

        const response = await fetch('https://api.twitch.tv/helix/extensions/pubsub', {
            method: 'POST',
            headers: {
                'Client-Id': clientId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target: ['broadcast'],
                broadcaster_id: channelId,
                is_global_broadcast: false,
                message: JSON.stringify(payload)
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('PubSub API Error:', response.status, errText);
        } else {
            console.log('PubSub Broadcast Sent!');
        }

    } catch (e) {
        console.error('Broadcast Exception:', e);
    }
}

// Serve Frontend Files (for local testing without Twitch)
app.use(express.static(path.join(__dirname, '../frontend')));

// Health Check
app.get('/', (req, res) => {
    res.send('Twitch EBS is running. Go to /panel.html to test frontend.');
});

// API Endpoints
// Endpoint to simulate a Bit transaction or Trigger from Frontend
const jwt = require('jsonwebtoken');

// Secrets (In production, use Environment Variables!)
// For local testing without real Twitch, we can skip verification or use a dummy secret.
// IMPORTANT: Get this from the Twitch Console (Base64 encoded)
const EXTENSION_SECRET = process.env.TWITCH_SECRET ? Buffer.from(process.env.TWITCH_SECRET, 'base64') : 'dummy-secret';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Middleware to verify Twitch JWT
const verifyTwitchToken = (req, res, next) => {
    // If we are in local testing mode and sending a dummy token, allow it.
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    if (!IS_PRODUCTION && token === 'dev-token') {
        req.user = { role: 'broadcaster' }; // Simulation
        return next();
    }

    try {
        const decoded = jwt.verify(token, EXTENSION_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error('JWT Verification failed:', err.message);
        console.error('Token:', token);
        console.error('Secret Length:', EXTENSION_SECRET.length);
        return res.status(403).json({ success: false, message: 'Invalid token' });
    }
};

// Get Current State (Initial Sync)
app.get('/api/state', verifyTwitchToken, (req, res) => {
    // Convert Maps to Objects
    const stateObj = Object.fromEntries(stateCache);
    res.json({
        state: stateObj,
        metadata: metadataCache
    });
});

const { addSessionTime, getSession, requireVip } = require('./transactions');

// ... (Existing Routes) ...

// Transaction Handler (Frontend sends this after Bits are used)
app.post('/api/transaction', verifyTwitchToken, (req, res) => {
    const { sku, transactionId } = req.body;
    const userId = req.user.user_id || req.user.opaque_user_id;

    if (!sku) {
        return res.status(400).json({ success: false, message: 'Missing SKU' });
    }

    const session = addSessionTime(userId, sku, transactionId);
    if (!session) {
        return res.status(400).json({ success: false, message: 'Invalid SKU' });
    }

    console.log(`[VIP] Transaction: ${sku} for user ${userId}. Expires: ${new Date(session.expiresAt).toISOString()}`);
    res.json({ success: true, session });
});

// Session Status Check
app.get('/api/session', verifyTwitchToken, (req, res) => {
    const userId = req.user.user_id || req.user.opaque_user_id;
    let session = getSession(userId);

    // Broadcaster always has VIP access for testing
    if (!session.active && req.user.role === 'broadcaster') {
        session = {
            active: true,
            expiresAt: Date.now() + 3600000, // 1 hour for testing
            isBroadcaster: true
        };
    }

    res.json({ success: true, session });
});

// Initial State Fetch
app.get('/api/state', verifyTwitchToken, (req, res) => {
    try {
        res.json({
            state: Object.fromEntries(stateCache),
            metadata: metadataCache
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Protected Endpoint: Trigger
// NOW PROTECTED by requireVip! 
app.post('/api/trigger', verifyTwitchToken, requireVip, (req, res) => {
    const { action, midi } = req.body;
    // ... (rest of logic) ...
    console.log(`Received trigger from ${req.user ? req.user.role : 'dev'}: ${action}`, midi);

    // Update Cache from Frontend Actions too (Optimistic update)
    if (midi.action === 'cc' || midi.action === 'fader' || midi.action === 'knob') {
        const key = `${midi.channel || 0}-${midi.controller}`;
        stateCache.set(key, midi.value);
    }

    if (bridgeSocket) {
        bridgeSocket.send(JSON.stringify({
            type: action === 'trigger' ? 'midi' : action,
            data: midi
        }));
        res.json({ success: true, message: 'Command relaying to bridge' });
    } else {
        res.status(503).json({ success: false, message: 'Bridge not connected' });
    }
});

server.listen(PORT, () => {
    console.log(`EBS listening on http://localhost:${PORT}`);
    console.log(`Build Timestamp: ${new Date().toISOString()}`);
});
