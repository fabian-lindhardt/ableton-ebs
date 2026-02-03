// Track Scanner for Twitch Ableton Sync
// Place this in a "js" object within a Max for Live Device

autowatch = 1;
outlets = 1;

var tracks = [];
var udpHost = "127.0.0.1";
var udpPort = 9005;

function loadbang() {
    post("Twitch Track Scanner Initialized\n");
    scan();
}

function scan() {
    var song = new LiveAPI("live_set");
    var trackCount = song.get("tracks").length / 2; // API returns IDs as pairs

    var currentData = [];

    for (var i = 0; i < trackCount; i++) {
        var track = new LiveAPI("live_set tracks " + i);
        if (track) {
            var name = track.get("name");
            var color = track.get("color");
            // Convert Ableton color (integer) to Hex
            var hexColor = "#" + ("000000" + color.toString(16)).slice(-6);

            currentData.push({
                index: i,
                name: name,
                color: hexColor
            });
        }
    }

    // Send as JSON via UDP
    var payload = {
        type: "metadata",
        data: currentData
    };

    outlet(0, "payload", JSON.stringify(payload));
}

// Trigger scan every 5 seconds or on demand
function bang() {
    scan();
}
