// Hardened Track Scanner & Command Guard for Twitch Ableton Sync
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
outlets = 1;

// Persistent API objects to prevent memory hammering/crashes
var songApi = new LiveAPI("live_set");
var trackApi = new LiveAPI("");
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");

function scan() {
    try {
        // 1. Scan Master Scenes
        var scenes = [];
        var sceneIds = songApi.get("scenes");
        var sceneCount = (sceneIds && sceneIds.length) ? (sceneIds.length / 2) : 0;

        for (var i = 0; i < sceneCount; i++) {
            sceneApi.path = "live_set scenes " + i;
            scenes.push({
                index: i,
                name: cleanString(sceneApi.get("name"))
            });
        }

        // 2. Scan Tracks & Clips
        var tracks = [];
        var trackIds = songApi.get("tracks");
        var trackCount = (trackIds && trackIds.length) ? (trackIds.length / 2) : 0;

        for (var i = 0; i < trackCount; i++) {
            trackApi.path = "live_set tracks " + i;
            var trackColor = trackApi.get("color");

            var clips = [];
            var clipSlots = trackApi.get("clip_slots");
            var slotCount = (clipSlots && clipSlots.length) ? (clipSlots.length / 2) : 0;

            // Limit clips to first 16 scenes for stability (standard Launchpad size)
            var maxClips = Math.min(slotCount, 16);

            for (var j = 0; j < maxClips; j++) {
                slotApi.path = "live_set tracks " + i + " clip_slots " + j;
                if (slotApi.get("has_clip") == 1) {
                    clipApi.path = "live_set tracks " + i + " clip_slots " + j + " clip";
                    clips.push({
                        index: j,
                        name: cleanString(clipApi.get("name")),
                        color: hexify(clipApi.get("color")),
                        is_playing: clipApi.get("is_playing") == 1,
                        is_triggered: clipApi.get("is_triggered") == 1
                    });
                }
            }

            tracks.push({
                index: i,
                name: cleanString(trackApi.get("name")),
                color: hexify(trackColor),
                clips: clips
            });
        }

        var payload = {
            type: "metadata",
            data: {
                tracks: tracks,
                scenes: scenes
            }
        };

        outlet(0, JSON.stringify(payload));
    } catch (err) {
        post("Scan Error: " + err + "\n");
    }
}

// Handle Incoming Commands (UDP is high priority, must defer to main thread)
function anything() {
    var args = arrayfromargs(messagename, arguments);

    // Defer the execution to avoid crashing Live API
    var t = new Task(function () {
        var cmd = args[0];
        if (cmd === "launch_clip") {
            var tIdx = args[1];
            var cIdx = args[2];
            var execApi = new LiveAPI("live_set tracks " + tIdx + " clip_slots " + cIdx);
            if (execApi) execApi.call("fire");
        } else if (cmd === "launch_scene") {
            var sIdx = args[1];
            var execApi = new LiveAPI("live_set scenes " + sIdx);
            if (execApi) execApi.call("fire");
        }

        // Wait 100ms before re-scanning to let Ableton process the launch
        var scanTask = new Task(scan, this);
        scanTask.schedule(100);

    }, this);

    t.schedule(0); // Execute on next low-priority loop
}

function bang() {
    scan();
}

function cleanString(val) {
    if (Array.isArray(val)) return val.join(" ");
    return val;
}

function hexify(colorVal) {
    var val = Array.isArray(colorVal) ? colorVal[0] : colorVal;
    return "#" + ("000000" + parseInt(val).toString(16)).slice(-6);
}
