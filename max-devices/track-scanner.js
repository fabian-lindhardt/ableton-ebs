// Segmented Reactive Engine v44.5 - Global API Reuse & Robust Commands
// Outlets: 0 -> to udpsend 127.0.0.1 9005

autowatch = 1;
inlets = 1;
outlets = 1;

// Global Persistent APIs
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
        post("v44.5: Observer Pool Active (" + poolSize + " tracks).\n");
    } catch (e) {
        post("v44.5 Init Error: " + e + "\n");
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

function anything() {
    var args = arrayfromargs(messagename, arguments);
    var cmd = args[0];

    post("v44.5 Command: " + cmd + " | Args: " + args.slice(1) + "\n");

    if (cmd === "launch_clip") {
        var tIdx = Number(args[1]);
        var sIdx = Number(args[2]);
        var path = "live_set tracks " + tIdx + " clip_slots " + sIdx;

        // REUSE GLOBAL API OBJECT (Guaranteed execution)
        slotApi.path = path;
        if (slotApi.id != 0) {
            slotApi.call("fire");
            post("v44.5: Fired Clip at " + path + "\n");
        } else {
            post("v44.5: Target Slot not found: " + path + "\n");
        }
    } else if (cmd === "launch_scene") {
        var sIdx = Number(args[1]);
        var path = "live_set scenes " + sIdx;

        sceneApi.path = path;
        if (sceneApi.id != 0) {
            sceneApi.call("fire");
            post("v44.5: Fired Scene at " + path + "\n");
        } else {
            post("v44.5: Target Scene not found: " + path + "\n");
        }
    } else if (cmd === "refresh") {
        bang();
    }
}

function loadbang() {
    bang();
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

initPool();
