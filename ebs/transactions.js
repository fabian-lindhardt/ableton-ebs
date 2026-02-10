const jwt = require('jsonwebtoken');

// In-Memory Session Store
const sessions = new Map(); // userId -> { expiresAt, sku }

// SKU to duration mapping (in milliseconds)
const SKU_DURATIONS = {
    'vip_1min': 1 * 60 * 1000,
    'vip_5min': 5 * 60 * 1000,
    'vip_15min': 15 * 60 * 1000,
    'free_vip': 1 * 60 * 1000, // 1 min free trial
};

const FREE_VIP_COOLDOWN = 5 * 60 * 1000;
const freeVipCooldowns = new Map(); // userId -> timestamp

// Helper: Get Free VIP Cooldown Status
function getCooldownStatus(userId) {
    const now = Date.now();
    const lastUsed = freeVipCooldowns.get(userId) || 0;
    const elapsed = now - lastUsed;

    if (elapsed < FREE_VIP_COOLDOWN) {
        return {
            available: false,
            remainingMs: FREE_VIP_COOLDOWN - elapsed,
            cooldownExpiresAt: lastUsed + FREE_VIP_COOLDOWN
        };
    }

    return { available: true, remainingMs: 0 };
}

function activateFreeVip(userId) {
    const now = Date.now();
    const lastUsed = freeVipCooldowns.get(userId) || 0;

    if (now - lastUsed < FREE_VIP_COOLDOWN) {
        return {
            success: false,
            remainingSeconds: Math.ceil((FREE_VIP_COOLDOWN - (now - lastUsed)) / 1000)
        };
    }

    // Set cooldown
    freeVipCooldowns.set(userId, now);

    // Create session (standard logic)
    const duration = SKU_DURATIONS['free_vip'];
    const expiresAt = now + duration;

    // Check if existing session is longer? No, free trial usually just adds time or replaces. 
    // Simplified: Just set/overwrite session for free trial.
    sessions.set(userId, { expiresAt, sku: 'free_vip' });

    console.log(`[Transactions] Free VIP activated for ${userId}`);
    return {
        success: true,
        session: { userId, expiresAt, duration, sku: 'free_vip' }
    };
}

// Helper: Get Session Status
function getSession(userId) {
    const session = sessions.get(userId);
    if (!session) return { active: false };

    if (Date.now() > session.expiresAt) {
        sessions.delete(userId);
        return { active: false };
    }

    return {
        active: true,
        expiresAt: session.expiresAt,
        remainingMs: session.expiresAt - Date.now()
    };
}

// Helper: Add Time to Session (by SKU)
function addSessionTime(userId, sku, transactionId) {
    const duration = SKU_DURATIONS[sku];
    if (!duration) {
        console.error(`[Transactions] Unknown SKU: ${sku}`);
        return null;
    }

    const now = Date.now();
    let expiresAt;

    const existing = sessions.get(userId);
    if (existing && existing.expiresAt > now) {
        expiresAt = existing.expiresAt + duration;
    } else {
        expiresAt = now + duration;
    }

    sessions.set(userId, { expiresAt, sku, transactionId });
    console.log(`[Transactions] VIP activated for ${userId} until ${new Date(expiresAt).toISOString()}`);

    return { userId, expiresAt, duration, sku };
}

// Middleware: Require VIP for actions
function requireVip(req, res, next) {
    if (req.user.role === 'broadcaster' || (process.env.NODE_ENV !== 'production' && req.user.role === 'external')) {
        return next();
    }

    const session = getSession(req.user.user_id || req.user.opaque_user_id);

    if (session && session.active) {
        return next();
    }

    return res.status(403).json({
        success: false,
        message: 'VIP Session Required. Please unlock control with Bits.'
    });
}

// Express Router Factory
function createTransactionRouter(express) {
    const router = express.Router();

    // POST /api/transaction - Process Bits purchase
    router.post('/transaction', (req, res) => {
        const { userId, sku, transactionId } = req.body;

        if (!userId || !sku) {
            return res.status(400).json({ error: 'Missing userId or sku' });
        }

        const result = addSessionTime(userId, sku, transactionId);
        if (!result) {
            return res.status(400).json({ error: 'Invalid SKU' });
        }

        console.log(`[Transactions] Bits Transaction:`, result);
        res.json({ success: true, session: result });
    });

    // GET /api/session - Check session status
    router.get('/session', (req, res) => {
        const userId = req.query.userId || req.user?.user_id || req.user?.opaque_user_id;

        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }

        const session = getSession(userId);
        res.json({ success: true, session });
    });

    // POST /api/dev-session - DEV: Activate without Bits
    router.post('/dev-session', (req, res) => {
        const { userId, durationMs } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }

        const duration = durationMs || 5 * 60 * 1000;
        const expiresAt = Date.now() + duration;

        sessions.set(userId, { expiresAt, sku: 'dev_session' });
        console.log(`[DEV] VIP activated for ${userId} until ${new Date(expiresAt).toISOString()}`);

        res.json({ success: true, session: { userId, expiresAt, duration } });
    });

    return router;
}

module.exports = {
    getSession,
    addSessionTime,
    requireVip,
    createTransactionRouter,
    activateFreeVip,
    getCooldownStatus,
    SKU_DURATIONS
};
