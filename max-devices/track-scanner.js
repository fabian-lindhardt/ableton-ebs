// Track Scanner & Command Guard for Twitch Ableton Sync
// Place this in a "js" object within a Max for Live Device
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
outlets = 1;

function scan() {
    var song = new LiveAPI("live_set");

    // 1. Scan Master Scenes
    var scenes = [];
    var sceneIds = song.get("scenes");
    var sceneCount = sceneIds.length / 2;
    for (var i = 0; i < sceneCount; i++) {
        var scene = new LiveAPI("live_set scenes " + i);
        if (scene) {
            scenes.push({
                index: i,
                name: cleanString(scene.get("name"))
            });
        }
    }

    // 2. Scan Tracks & Clips
    var tracks = [];
    var trackIds = song.get("tracks");
    var trackCount = trackIds.length / 2;

    for (var i = 0; i < trackCount; i++) {
        var track = new LiveAPI("live_set tracks " + i);
        if (track) {
            var trackColor = track.get("color");
            var hexTrackColor = hexify(trackColor);

            var clips = [];
            var clipSlots = track.get("clip_slots");
            var slotCount = clipSlots.length / 2;

            // Limit clips to first 20 scenes to keep payload reasonable
            var maxClips = Math.min(slotCount, 24);

            for (var j = 0; j < maxClips; j++) {
                var slot = new LiveAPI("live_set tracks " + i + " clip_slots " + j);
                if (slot && slot.get("has_clip") == 1) {
                    var clip = new LiveAPI("live_set tracks " + i + " clip_slots " + j + " clip");
                    if (clip) {
                        clips.push({
                            index: j,
                            name: cleanString(clip.get("name")),
                            color: hexify(clip.get("color")),
                            is_playing: clip.get("is_playing") == 1,
                            is_triggered: clip.get("is_triggered") == 1
                        });
                    }
                }
            }

            tracks.push({
                index: i,
                name: cleanString(track.get("name")),
                color: hexTrackColor,
                clips: clips
            });
        }
    }

    var payload = {
        type: "metadata",
        data: {
            tracks: tracks,
            scenes: scenes
        }
    };

    outlet(0, JSON.stringify(payload));
}

// Handle Incoming Commands from Bridge (udpreceive -> js)
function anything() {
    var args = arrayfromargs(messagename, arguments);
    var cmd = args[0];

    if (cmd === "launch_clip") {
        var tIdx = args[1];
        var cIdx = args[2];
        var slot = new LiveAPI("live_set tracks " + tIdx + " clip_slots " + cIdx);
        if (slot) slot.call("fire");
        post("Launched Clip: Track " + tIdx + " Slot " + cIdx + "\n");
    } else if (cmd === "launch_scene") {
        var sIdx = args[1];
        var scene = new LiveAPI("live_set scenes " + sIdx);
        if (scene) scene.call("fire");
        post("Launched Scene: " + sIdx + "\n");
    }

    // Auto-scan after a command to update states
    scan();
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
