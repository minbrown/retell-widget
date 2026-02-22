// build.js — Bundles retell-client-js-sdk into a browser-ready file
// Run automatically via `npm start` before the server launches.
import { build } from "esbuild";

await build({
    // Entry: import only the RetellWebClient class from the installed npm package
    entryPoints: ["retell-entry.js"],
    bundle: true,
    // Output a single browser-ready file served as a static asset
    outfile: "public/retell-sdk.js",
    format: "iife",           // Wraps in an IIFE so it works in a plain <script> tag
    globalName: "RetellSDK",  // Exposes as window.RetellSDK.RetellWebClient
    platform: "browser",
    minify: true,
});

console.log("✅ Retell SDK bundled → public/retell-sdk.js");
