require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 8080;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('../frontend')); // Serve frontend files


let bridgeSocket = null;

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

            // 2. Sync from Bridge (Ableton -> Extension)
            if (data.type === 'sync') {
                // console.log('Received Sync:', data.data);
                // Broadcast to Twitch PubSub
                await broadcastToPubSub(data);
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
            exp: Math.floor(Date.now() / 1000) + 10, // 10s expiration
            user_id: 'owner', // Role
            role: 'external',
            channel_id: channelId,
            pubsub_perms: {
                send: ['broadcast']
            }
        }, EXTENSION_SECRET, { algorithm: 'HS256' });

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
            // console.log('PubSub Broadcast Sent!');
        }

    } catch (e) {
        console.error('Broadcast Exception:', e);
    }
}

// API Endpoints
app.get('/', (req, res) => {
    res.send('Twitch Ableton EBS is running.');
});

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

// Endpoint to simulate a Bit transaction or Trigger from Frontend
app.post('/api/trigger', verifyTwitchToken, (req, res) => {
    const { action, midi } = req.body;

    console.log(`Received trigger from ${req.user ? req.user.role : 'dev'}: ${action}`, midi);

    if (bridgeSocket) {
        bridgeSocket.send(JSON.stringify({
            type: 'midi',
            data: midi
        }));
        res.json({ success: true, message: 'Command relaying to bridge' });
    } else {
        res.status(503).json({ success: false, message: 'Bridge not connected' });
    }
});

server.listen(PORT, () => {
    console.log(`EBS listening on http://localhost:${PORT}`);
});
