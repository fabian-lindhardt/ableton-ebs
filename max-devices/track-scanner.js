// Streamlined Deep Scanner v40 - Payload Optimized
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
var maxDiscoveryLimit = 32;
var scanData = { tracks: [], scenes: [] };
var isScanning = false;

var scanTask = new Task(iterateScan, this);

function iterateScan() {
    try {
        if (!isScanning) return;

        if (currentTrackIndex >= maxDiscoveryLimit) {
            // FINISHED
            outlet(0, JSON.stringify({ type: "metadata", data: scanData }));
            isScanning = false;
            return;
        }

        trackApi.path = "live_set tracks " + currentTrackIndex;

        if (trackApi.id && trackApi.id !== "0") {
            var tName = cleanString(trackApi.get("name"));
            var tColor = trackApi.get("color");
            var clips = [];

            // Scan 12 clips per track (streamlined from 16 to save space)
            for (var j = 0; j < 12; j++) {
                slotApi.path = "live_set tracks " + currentTrackIndex + " clip_slots " + j;
                if (slotApi.id !== "0" && slotApi.get("has_clip") == 1) {
                    clipApi.path = "live_set tracks " + currentTrackIndex + " clip_slots " + j + " clip";
                    if (clipApi.id !== "0") {
                        clips.push({
                            index: j,
                            name: limitStr(cleanString(clipApi.get("name")), 10), // Ultra-short names
                            color: hexify(clipApi.get("color")),
                            is_playing: clipApi.get("is_playing") == 1,
                            is_triggered: clipApi.get("is_triggered") == 1
                        });
                    }
                }
            }

            scanData.tracks.push({
                index: currentTrackIndex,
                name: limitStr(tName, 12),
                color: hexify(tColor),
                clips: clips
            });
        }

        currentTrackIndex++;
        scanTask.schedule(20);

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
        // 1. Brute Force Scene Scan (Probing 12 scenes)
        for (var i = 0; i < 12; i++) {
            sceneApi.path = "live_set scenes " + i;
            if (sceneApi.id && sceneApi.id !== "0") {
                scanData.scenes.push({
                    index: i,
                    name: limitStr(cleanString(sceneApi.get("name")), 12)
                });
            }
        }
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
                var ea = new LiveAPI("live_set tracks " + args[1] + " clip_slots " + args[2]);
                if (ea && ea.id !== "0") ea.call("fire");
            } else if (cmd === "launch_scene") {
                var ea = new LiveAPI("live_set scenes " + args[1]);
                if (ea && ea.id !== "0") ea.call("fire");
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
