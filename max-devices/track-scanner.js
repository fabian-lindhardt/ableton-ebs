// Hardened Iterative Scanner v36 - Deep Scanning with Scenes
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
outlets = 1;

// Global Pool
var songApi = new LiveAPI("live_set");
var trackApi = new LiveAPI("");
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");

// State
var currentTrackIndex = 0;
var totalTracks = 0;
var scanData = { tracks: [], scenes: [] };
var isScanning = false;

var scanTask = new Task(iterateScan, this);

function iterateScan() {
    try {
        if (!isScanning) return;

        if (currentTrackIndex >= totalTracks) {
            // FINISHED: Send the collected data
            outlet(0, JSON.stringify({ type: "metadata", data: scanData }));
            isScanning = false;
            return;
        }

        trackApi.goto("live_set", "tracks", currentTrackIndex);
        if (trackApi.id !== "0") {
            var tName = limitStr(cleanString(trackApi.get("name")), 12);
            var tColor = trackApi.get("color");
            var clips = [];

            var slotCount = trackApi.getcount("clip_slots");
            var maxSlots = Math.min(slotCount, 12);

            for (var j = 0; j < maxSlots; j++) {
                slotApi.goto("live_set", "tracks", currentTrackIndex, "clip_slots", j);
                if (slotApi.id !== "0" && slotApi.get("has_clip") == 1) {
                    clipApi.goto("live_set", "tracks", currentTrackIndex, "clip_slots", j, "clip");
                    clips.push({
                        index: j,
                        name: limitStr(cleanString(clipApi.get("name")), 12),
                        color: hexify(clipApi.get("color")),
                        is_playing: clipApi.get("is_playing") == 1,
                        is_triggered: clipApi.get("is_triggered") == 1
                    });
                }
            }

            scanData.tracks.push({
                index: currentTrackIndex,
                name: tName,
                color: hexify(tColor),
                clips: clips
            });
        }

        currentTrackIndex++;
        scanTask.schedule(40); // Safe 40ms intervals

    } catch (e) {
        isScanning = false;
    }
}

function startScan() {
    if (isScanning) scanTask.cancel();

    isScanning = true;
    currentTrackIndex = 0;
    scanData = { tracks: [], scenes: [] };

    try {
        songApi.path = "live_set";
        totalTracks = Math.min(songApi.getcount("tracks"), 32); // Increased to 32 tracks

        // 1. Scan Master Scenes (Limit to 12)
        var sceneCount = Math.min(songApi.getcount("scenes"), 12);
        for (var i = 0; i < sceneCount; i++) {
            sceneApi.goto("live_set", "scenes", i);
            scanData.scenes.push({
                index: i,
                name: limitStr(cleanString(sceneApi.get("name")), 12)
            });
        }

        // 2. Start Iterative Track Scan
        iterateScan();
    } catch (e) {
        isScanning = false;
    }
}

function bang() {
    startScan();
}

function anything() {
    var args = arrayfromargs(messagename, arguments);
    var t = new Task(function () {
        try {
            var cmd = args[0];
            if (cmd === "launch_clip") {
                var execApi = new LiveAPI("live_set tracks " + args[1] + " clip_slots " + args[2]);
                if (execApi && execApi.id !== "0") execApi.call("fire");
            } else if (cmd === "launch_scene") {
                var execApi = new LiveAPI("live_set scenes " + args[1]);
                if (execApi && execApi.id !== "0") execApi.call("fire");
            }
            startScan();
        } catch (e) { }
    }, this);
    t.schedule(0);
}

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
