// bridge_diagnostic.js
console.log("DIAGNOSTIC: STARTING DEEP SCAN...");

try {
    console.log("DIAGNOSTIC: Path to this script: " + __filename);
    console.log("DIAGNOSTIC: Current working directory: " + process.cwd());

    console.log("DIAGNOSTIC: Attempting to resolve 'max-api'...");
    const resolvedPath = require.resolve('max-api');
    console.log("DIAGNOSTIC: 'max-api' RESOLVED TO: " + resolvedPath);

    const max = require('max-api');
    console.log("DIAGNOSTIC: 'max-api' required successfully.");
    console.log("DIAGNOSTIC: type of max: " + typeof max);

    if (max && typeof max.post === 'function') {
        max.post("SUCCESS: Integrated max-api found and working!");
    } else {
        console.error("FAILURE: max.post is NOT a function. Object keys: " + Object.keys(max || {}).join(', '));
    }
} catch (e) {
    console.error("DIAGNOSTIC CRASH: " + e.message);
    console.error(e.stack);
}

// Check for global node_modules or other paths
console.log("DIAGNOSTIC: module.paths: " + JSON.stringify(module.paths, null, 2));

setInterval(() => {
    console.log("DIAGNOSTIC: Heartbeat...");
}, 5000);
