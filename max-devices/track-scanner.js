// Reactive Observer Engine v42 - Push-Style Integration
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
outlets = 1;

// Global Pool
var songApi = new LiveAPI("live_set");
var trackApis = []; // Pool of 32 persistent observers
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");

// State
var scanData = { tracks: [], scenes: [] };
var isInitialized = false;

// 1. Initialize Observer Pool
function initPool() {
    for (var i = 0; i < 32; i++) {
        var api = new LiveAPI(trackCallback, "live_set tracks " + i);
        if (api) {
            api.property = "playing_slot_index"; // Monitor play state
            api.property = "fired_slot_index";   // Monitor launch state
            trackApis.push(api);
        }
    }
    post("Observer Pool Initialized: 32 Tracks Bound.\n");
}

function trackCallback(args) {
    if (!isInitialized) return;

    // args[0] is property name (playing_slot_index / fired_slot_index)
    // args[1] is the value
    // We can't easily tell WHICH track fired from the generic callback in older Max versions
    // So we use 'this.path' or similar if available, otherwise we re-scan the changed track logic.
    // Optimization: When ANY track fires a state change, we trigger a small targeted scan.
    var path = this.path;
    if (path) {
        var parts = path.split(" ");
        var trackIdx = parseInt(parts[2]);
        scanTrack(trackIdx);
    }
}

function scanTrack(idx) {
    try {
        var tApi = new LiveAPI("live_set tracks " + idx);
        if (!tApi || tApi.id === "0") return;

        var clips = [];
        for (var j = 0; j < 12; j++) {
            slotApi.path = "live_set tracks " + idx + " clip_slots " + j;
            if (slotApi.id !== "0" && slotApi.get("has_clip") == 1) {
                clipApi.path = "live_set tracks " + idx + " clip_slots " + j + " clip";
                if (clipApi.id !== "0") {
                    clips.push({
                        index: j,
                        name: limitStr(cleanString(clipApi.get("name")), 10),
                        color: hexify(clipApi.get("color")),
                        is_playing: clipApi.get("is_playing") == 1,
                        is_triggered: clipApi.get("is_triggered") == 1
                    });
                }
            }
        }

        var update = {
            type: "metadata",
            data: {
                tracks: [{
                    index: idx,
                    name: limitStr(cleanString(tApi.get("name")), 12),
                    color: hexify(tApi.get("color")),
                    clips: clips
                }]
            }
        };
        outlet(0, JSON.stringify(update));
    } catch (e) { }
}

// Full Discovery Scan (Names, Colors, Scenes) - Triggered on load or Refresh
function fullScan() {
    scanData = { tracks: [], scenes: [] };

    // 1. Scenes (Brute Force 16)
    for (var i = 0; i < 16; i++) {
        sceneApi.path = "live_set scenes " + i;
        if (sceneApi.id && sceneApi.id !== "0") {
            scanData.scenes.push({
                index: i,
                name: limitStr(cleanString(sceneApi.get("name")), 12)
            });
        }
    }

    // 2. Initial Track Data
    for (var i = 0; i < 32; i++) {
        var tApi = new LiveAPI("live_set tracks " + i);
        if (tApi && tApi.id !== "0") {
            var clips = [];
            // Basic clip states
            for (var j = 0; j < 12; j++) {
                slotApi.path = "live_set tracks " + i + " clip_slots " + j;
                if (slotApi.id !== "0" && slotApi.get("has_clip") == 1) {
                    clipApi.path = "live_set tracks " + i + " clip_slots " + j + " clip";
                    clips.push({
                        index: j,
                        name: limitStr(cleanString(clipApi.get("name")), 10),
                        color: hexify(clipApi.get("color")),
                        is_playing: clipApi.get("is_playing") == 1,
                        is_triggered: clipApi.get("is_triggered") == 1
                    });
                }
            }
            scanData.tracks.push({
                index: i,
                name: limitStr(cleanString(tApi.get("name")), 12),
                color: hexify(tApi.get("color")),
                clips: clips
            });
        }
    }

    outlet(0, JSON.stringify({ type: "metadata", data: scanData }));
    isInitialized = true;
}

function bang() {
    fullScan();
}

function anything() {
    var args = arrayfromargs(messagename, arguments);
    var cmd = args[0];
    if (cmd === "launch_clip") {
        var ea = new LiveAPI("live_set tracks " + args[1] + " clip_slots " + args[2]);
        if (ea && ea.id !== "0") ea.call("fire");
    } else if (cmd === "launch_scene") {
        var ea = new LiveAPI("live_set scenes " + args[1]);
        if (ea && ea.id !== "0") ea.call("fire");
    } else if (cmd === "refresh") {
        fullScan();
    }
}

// Helpers
function limitStr(str, max) {
    if (!str) return "";
    var s = String(str);
    if (s.length > max) return s.substring(0, max) + "..";
    return s;
}

function cleanString(val) {
    if (!val) return "";
    if (Array.isArray(val)) return val.join(" ");
    return String(val);
}

function hexify(colorVal) {
    var val = Array.isArray(colorVal) ? colorVal[0] : colorVal;
    if (val === undefined || val === null) return "#666666";
    return "#" + ("000000" + parseInt(val).toString(16)).slice(-6);
}

// Init on load
initPool();
