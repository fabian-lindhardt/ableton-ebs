// Hardened Track Scanner v34.2 - Final Stability & Accuracy
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
outlets = 1;

// Persistent API objects to prevent memory hammering
var songApi = new LiveAPI("live_set");
var trackApi = new LiveAPI("");
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");

function scan() {
    try {
        // Ensure we are attached to the actual live_set
        songApi.path = "live_set";

        // 1. Scan Master Scenes
        var scenes = [];
        var sceneIds = songApi.get("scenes");

        // Ableton returns IDs as "id 1 id 2" ... so length / 2
        var sceneCount = (sceneIds && sceneIds.length) ? (sceneIds.length / 2) : 0;

        for (var i = 0; i < sceneCount; i++) {
            sceneApi.path = "live_set scenes " + i;
            var sName = sceneApi.get("name");
            scenes.push({
                index: i,
                name: cleanString(sName)
            });
        }

        // 2. Scan Tracks & Clips
        var tracks = [];
        var trackIds = songApi.get("tracks");
        var trackCount = (trackIds && trackIds.length) ? (trackIds.length / 2) : 0;

        // post("Scanning Set: " + trackCount + " tracks found.\n");

        for (var i = 0; i < trackCount; i++) {
            trackApi.path = "live_set tracks " + i;
            var trackColor = trackApi.get("color");
            var trackName = trackApi.get("name");

            var clips = [];
            var clipSlots = trackApi.get("clip_slots");
            var slotCount = (clipSlots && clipSlots.length) ? (clipSlots.length / 2) : 0;

            // Limit clips to first 16 scenes for UI performance
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
                name: cleanString(trackName),
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

        // Re-scan after a short delay
        scan();
    }, this);

    t.schedule(0);
}

function bang() {
    scan();
}

function cleanString(val) {
    if (!val) return "---";
    if (Array.isArray(val)) return val.join(" ");
    return val;
}

function hexify(colorVal) {
    var val = Array.isArray(colorVal) ? colorVal[0] : colorVal;
    if (val === undefined || val === null) return "#666666";
    return "#" + ("000000" + parseInt(val).toString(16)).slice(-6);
}
