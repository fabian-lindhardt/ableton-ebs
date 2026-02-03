// Ghost Protocol v43 - Non-Blocking Queue & Single Threaded Execution
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
outlets = 1;

// Persistent Singleton APIs
var trackApis = [];
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");

// State Management
var updateQueue = [];
var isScanning = false;
var activeTrackCount = 0;

// Update Processor Loop
var processTask = new Task(function () {
    if (updateQueue.length > 0) {
        var trackIdx = updateQueue.shift();
        executeTrackScan(trackIdx);
    }
}, this);
processTask.interval = 100; // Safe 10Hz update rate
processTask.repeat();

function initPool() {
    try {
        // Clear old
        trackApis = [];
        updateQueue = [];

        var song = new LiveAPI("live_set");
        var trackIds = song.get("tracks");
        activeTrackCount = (trackIds && trackIds.length) ? (trackIds.length / 2) : 0;

        // Safety cap for discovery
        var poolSize = Math.min(activeTrackCount, 32);

        for (var i = 0; i < poolSize; i++) {
            var api = new LiveAPI(trackCallback, "live_set tracks " + i);
            if (api) {
                api.trackIdx = i; // Inject identity
                api.property = "playing_slot_index";
                api.property = "fired_slot_index";
                trackApis.push(api);
            }
        }
        post("v43 Ghost Protocol: " + poolSize + " Track Observers Active.\n");
    } catch (e) {
        post("Init Error: " + e + "\n");
    }
}

function trackCallback(args) {
    // DO NOT CREATE API OBJECTS HERE!
    // Push index to queue and let the Task handle it later.
    var idx = this.trackIdx;
    if (idx !== undefined) {
        if (updateQueue.indexOf(idx) === -1) {
            updateQueue.push(idx);
        }
    }
}

function executeTrackScan(idx) {
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
                        name: limitStr(cleanString(clipApi.get("name")), 8),
                        color: hexify(clipApi.get("color")),
                        is_playing: clipApi.get("is_playing") == 1,
                        is_triggered: clipApi.get("is_triggered") == 1
                    });
                }
            }
        }

        var payload = {
            type: "metadata",
            data: {
                tracks: [{
                    index: idx,
                    name: limitStr(cleanString(tApi.get("name")), 10),
                    color: hexify(tApi.get("color")),
                    clips: clips
                }]
            }
        };
        outlet(0, JSON.stringify(payload));
    } catch (e) { }
}

function fullScan() {
    try {
        var scenes = [];
        for (var i = 0; i < 12; i++) {
            sceneApi.path = "live_set scenes " + i;
            if (sceneApi.id && sceneApi.id !== "0") {
                scenes.push({
                    index: i,
                    name: limitStr(cleanString(sceneApi.get("name")), 10)
                });
            }
        }

        outlet(0, JSON.stringify({ type: "metadata", data: { scenes: scenes, tracks: [] } }));

        // Queue all tracks for initial population
        for (var i = 0; i < trackApis.length; i++) {
            updateQueue.push(i);
        }
    } catch (e) { }
}

function bang() {
    initPool();
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
        bang();
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

// Bootstrap
initPool();
