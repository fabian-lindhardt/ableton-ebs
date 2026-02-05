// Segmented Reactive Engine v53 - live.thisdevice Triggered
autowatch = 1;
inlets = 1;
outlets = 1;

var trackApis = [];
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");
var loopApi = null; // Observer for loop property
var sceneCount = 0;
var isInitialized = false;

// Callback for loop property changes
function loopCallback(args) {
    if (args[0] === "loop") {
        var loopVal = args[1] ? 127 : 0; // Convert boolean to MIDI value
        post("v53: Loop changed to " + (args[1] ? "ON" : "OFF") + "\n");
        // Send sync message: CC44 on channel 0 (matching Twitch extension config)
        outlet(0, "sync", 0, 44, loopVal);
    }
}

function initPool() {
    try {
        post("v53: Initializing Pool...\n");
        trackApis = [];
        var song = new LiveAPI("live_set");

        // Debug Object Validity
        post("v53: Song API ID: " + song.id + ", Path: " + song.path + "\n");

        if (!song || !song.path || song.id == "0") {
            post("v53: Live API not ready (ID is 0 or path empty).\n");
            return;
        }

        // Get dynamic scene count
        var sceneIds = song.get("scenes");
        var rawSceneCount = (sceneIds && sceneIds.length) ? (sceneIds.length / 2) : 0;
        sceneCount = (rawSceneCount > 0) ? rawSceneCount : 12;
        post("v53: Detected " + sceneCount + " scenes.\n");

        // Get track count
        var trackIds = song.get("tracks");
        var activeCount = (trackIds && trackIds.length) ? (trackIds.length / 2) : 0;
        post("v53: Raw Track Count: " + activeCount + "\n");

        // Fallback: visible_tracks
        if (activeCount === 0) {
            post("v53: 'tracks' empty. Trying 'visible_tracks'...\n");
            var visibleTrackIds = song.get("visible_tracks");
            activeCount = (visibleTrackIds && visibleTrackIds.length) ? (visibleTrackIds.length / 2) : 0;
            post("v53: Visible Track Count: " + activeCount + "\n");
        }

        if (activeCount === 0) {
            post("v53: ERROR - Still 0 tracks found. Check if device is on a track.\n");
            return;
        }

        var poolSize = Math.min(activeCount, 32);
        for (var i = 0; i < poolSize; i++) {
            var api = new LiveAPI(trackCallback, "live_set tracks " + i);
            if (api && api.id != "0") {
                api.trackIdx = i;
                api.property = "playing_slot_index";
                api.property = "fired_slot_index";
                trackApis.push(api);
            }
        }

        isInitialized = true;
        post("v53: Pool Ready (" + trackApis.length + " tracks observed).\n");

        // Setup Loop Observer
        loopApi = new LiveAPI(loopCallback, "live_set");
        if (loopApi && loopApi.id != "0") {
            loopApi.property = "loop";
            post("v53: Loop Observer active.\n");
        }

        segmentedRefresh();

    } catch (e) {
        post("v53 Init Error: " + e + "\n");
    }
}

function trackCallback(args) {
    if (args[0] === "playing_slot_index" || args[0] === "fired_slot_index") {
        sendTrackData(this.trackIdx);
    }
}

function sendTrackData(idx) {
    try {
        if (!isInitialized) return;
        var tApi = new LiveAPI("live_set tracks " + idx);

        if (!tApi || tApi.id == "0") return;

        var clips = [];
        for (var j = 0; j < sceneCount; j++) {
            slotApi.path = "live_set tracks " + idx + " clip_slots " + j;
            if (slotApi.id != "0" && slotApi.get("has_clip") == 1) {
                clipApi.path = "live_set tracks " + idx + " clip_slots " + j + " clip";
                if (clipApi.id != "0") {
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

        var payload = JSON.stringify({
            tracks: [{ index: idx, name: limitStr(cleanString(tApi.get("name")), 12), color: hexify(tApi.get("color")), clips: clips }]
        });
        outlet(0, "metadata", payload);
    } catch (e) { }
}

function segmentedRefresh() {
    try {
        if (!isInitialized) return;
        post("v53: Syncing Grid (" + sceneCount + " scenes)...\n");
        var scenes = [];
        for (var i = 0; i < sceneCount; i++) {
            sceneApi.path = "live_set scenes " + i;
            if (sceneApi.id != "0") {
                scenes.push({ index: i, name: limitStr(cleanString(sceneApi.get("name")), 12) });
            }
        }

        outlet(0, "metadata", JSON.stringify({ scenes: scenes, tracks: [] }));

        var staggerTask = new Task(function () {
            if (this.current < trackApis.length) {
                sendTrackData(this.current);
                this.current++;
            } else {
                post("v53: Grid Sync Complete.\n");
                arguments.callee.task.cancel();
            }
        }, this);
        staggerTask.current = 0;
        staggerTask.interval = 50;
        staggerTask.repeat(trackApis.length);
    } catch (e) { }
}

// HANDLERS
function cmd_clip(action, trackIdx, slotIdx) {
    post("v53: cmd_clip received: action=" + action + " trackIdx=" + trackIdx + " slotIdx=" + slotIdx + "\n");
    if (action === "launch") {
        var tIdx = parseInt(trackIdx);
        var sIdx = parseInt(slotIdx);
        post("v53: LAUNCH CLIP T" + tIdx + " S" + sIdx + "\n");
        slotApi.path = "live_set tracks " + tIdx + " clip_slots " + sIdx;
        if (slotApi.id != "0") {
            slotApi.call("fire");
        }
    }
}

function cmd_scene(action, sceneIdx) {
    if (action === "launch") {
        post("v53: LAUNCH SCENE " + sceneIdx + "\n");
        sceneApi.path = "live_set scenes " + sceneIdx;
        if (sceneApi.id != "0") {
            sceneApi.call("fire");
        }
    }
}

function cmd_track(action, trackIdx) {
    if (action === "stop") {
        post("v53: STOP TRACK " + trackIdx + "\n");
        var trackApi = new LiveAPI("live_set tracks " + trackIdx);
        if (trackApi.id != "0") {
            trackApi.call("stop_all_clips");
        }
    }
}

// LEGACY ALIASES
function clip(a, b, c) { cmd_clip(a, b, c); }
function scene(a, b) { cmd_scene(a, b); }
function track(a, b) { cmd_track(a, b); }

// bang() is now the PRIMARY init trigger (from live.thisdevice via delay)
function bang() {
    initPool();
}

// loadbang is kept as a fallback, but with no auto-retry logic
function loadbang() {
    // Do nothing. Wait for live.thisdevice to trigger init via bang.
    post("v53: loadbang received. Waiting for live.thisdevice trigger...\n");
}

function limitStr(str, max) { if (!str) return ""; var s = String(str); return s.length > max ? s.substring(0, max) + ".." : s; }
function cleanString(val) { if (!val) return ""; return Array.isArray(val) ? val.join(" ") : String(val); }
function hexify(colorVal) { var val = Array.isArray(colorVal) ? colorVal[0] : colorVal; return val == null ? "#666666" : "#" + ("000000" + parseInt(val).toString(16)).slice(-6); }

post("v53 Script Loaded (Waiting for live.thisdevice).\n");
