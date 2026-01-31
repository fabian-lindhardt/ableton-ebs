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
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'identify' && data.role === 'bridge') {
                console.log('Locald Bridge connected.');
                bridgeSocket = ws;
            }
        } catch (e) {
            // ignore
        }
    });

    ws.on('close', () => {
        if (ws === bridgeSocket) {
            console.log('Local Bridge disconnected.');
            bridgeSocket = null;
        }
    });
});

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
