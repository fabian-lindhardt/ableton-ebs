const jwt = require('jsonwebtoken');

// In-Memory Session Store
// Key: userId (String), Value: { val: (milliseconds), role: 'vip' }
// We use a simple expiration timestamp
const sessions = new Map();

// Configuration
const COST_PER_MINUTE = 20; // Example: 100 Bits = 5 Minutes

// Helper: Get Session Status
function getSession(userId) {
    const session = sessions.get(userId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
        sessions.delete(userId); // Cleanup
        return null;
    }

    return {
        isActive: true,
        expiresAt: session.expiresAt,
        remainingMs: session.expiresAt - Date.now()
    };
}

// Helper: Add Time to Session
function addSessionTime(userId, bitsUsed) {
    // Logic: 100 Bits = 5 Minutes
    // 1 Bit = 3 Seconds? 
    // Let's say 100 Bits = 300 Seconds = 300,000 ms
    // So 1 Bit = 3000 ms
    const msToAdd = bitsUsed * 3000;

    let currentExpiresAt = Date.now();
    const existing = sessions.get(userId);

    if (existing && existing.expiresAt > Date.now()) {
        currentExpiresAt = existing.expiresAt;
    }

    const newExpiresAt = currentExpiresAt + msToAdd;

    sessions.set(userId, {
        expiresAt: newExpiresAt,
        role: 'vip'
    });

    return {
        expiresAt: newExpiresAt,
        addedMs: msToAdd,
        totalRemainingMs: newExpiresAt - Date.now()
    };
}

// Middleware: Verify VIP Status for Critical Actions
// Assumes `req.user` is populated by verifyTwitchToken
function requireVip(req, res, next) {
    // Dev/Broadcaster Override
    if (req.user.role === 'broadcaster' || (process.env.NODE_ENV !== 'production' && req.user.role === 'external')) {
        return next();
    }

    const session = getSession(req.user.user_id); // Twitch JWT uses user_id or opaque_user_id

    if (session && session.isActive) {
        return next();
    }

    return res.status(403).json({
        success: false,
        message: 'VIP Session Required. Please unlock control with Bits.'
    });
}

module.exports = {
    getSession,
    addSessionTime,
    requireVip
};
