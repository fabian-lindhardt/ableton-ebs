// Segmented Reactive Engine v45 - OSC Commands + Grid Sync
autowatch = 1;
inlets = 1;
outlets = 1;

var trackApis = [];
var slotApi = new LiveAPI("");
var clipApi = new LiveAPI("");
var sceneApi = new LiveAPI("");

function initPool() {
    try {
        trackApis = [];
        var song = new LiveAPI("live_set");
        var trackIds = song.get("tracks");
        var activeCount = (trackIds && trackIds.length) ? (trackIds.length / 2) : 0;
        var poolSize = Math.min(activeCount, 32);

        for (var i = 0; i < poolSize; i++) {
            var api = new LiveAPI(trackCallback, "live_set tracks " + i);
            if (api) {
                api.trackIdx = i;
                api.property = "playing_slot_index";
                api.property = "fired_slot_index";
                trackApis.push(api);
            }
        }
        post("v45: Observer Pool (" + poolSize + " tracks).\n");
    } catch (e) {
        post("v45 Init Error: " + e + "\n");
    }
}

function trackCallback(args) {
    if (args[0] === "playing_slot_index" || args[0] === "fired_slot_index") {
        sendTrackData(this.trackIdx);
    }
}

function sendTrackData(idx) {
    try {
        var tApi = new LiveAPI("live_set tracks " + idx);
        if (!tApi || tApi.id == 0) return;
        var clips = [];
        for (var j = 0; j < 12; j++) {
            slotApi.path = "live_set tracks " + idx + " clip_slots " + j;
            if (slotApi.id != 0 && slotApi.get("has_clip") == 1) {
                clipApi.path = "live_set tracks " + idx + " clip_slots " + j + " clip";
                if (clipApi.id != 0) {
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
        outlet(0, JSON.stringify({
            type: "metadata",
            data: { tracks: [{ index: idx, name: limitStr(cleanString(tApi.get("name")), 12), color: hexify(tApi.get("color")), clips: clips }] }
        }));
    } catch (e) { }
}

function segmentedRefresh() {
    try {
        post("v45: Syncing Grid...\n");
        var scenes = [];
        for (var i = 0; i < 12; i++) {
            sceneApi.path = "live_set scenes " + i;
            if (sceneApi.id != 0) {
                scenes.push({ index: i, name: limitStr(cleanString(sceneApi.get("name")), 12) });
            }
        }
        outlet(0, JSON.stringify({ type: "metadata", data: { scenes: scenes, tracks: [] } }));

        var staggerTask = new Task(function () {
            if (this.current < trackApis.length) {
                sendTrackData(this.current);
                this.current++;
            } else {
                post("v45: Grid Sync Complete.\n");
                arguments.callee.task.cancel();
            }
        }, this);
        staggerTask.current = 0;
        staggerTask.interval = 50;
        staggerTask.repeat(trackApis.length);
    } catch (e) { }
}

// HANDLERS
function bang() {
    initPool();
    segmentedRefresh();
}

function msg_int(v) {
    if (v == 1) bang();
}

// OSC Command Handler
function anything() {
    var address = messagename;
    var args = arrayfromargs(arguments);

    // Check if it's an OSC address (starts with /)
    if (address.charAt(0) === "/") {
        post("v45 OSC: " + address + " | " + args + "\n");

        if (address === "/launch_clip" && args.length >= 2) {
            slotApi.path = "live_set tracks " + args[0] + " clip_slots " + args[1];
            if (slotApi.id != 0) {
                slotApi.call("fire");
                post("v45: FIRED CLIP T" + args[0] + " S" + args[1] + "\n");
            }
        } else if (address === "/launch_scene" && args.length >= 1) {
            sceneApi.path = "live_set scenes " + args[0];
            if (sceneApi.id != 0) {
                sceneApi.call("fire");
                post("v45: FIRED SCENE " + args[0] + "\n");
            }
        }
    } else if (address === "refresh") {
        bang();
    }
}

function loadbang() { bang(); }

function limitStr(str, max) { if (!str) return ""; var s = String(str); return s.length > max ? s.substring(0, max) + ".." : s; }
function cleanString(val) { if (!val) return ""; return Array.isArray(val) ? val.join(" ") : String(val); }
function hexify(colorVal) { var val = Array.isArray(colorVal) ? colorVal[0] : colorVal; return val == null ? "#666666" : "#" + ("000000" + parseInt(val).toString(16)).slice(-6); }

initPool();
post("v45 LOADED.\n");
