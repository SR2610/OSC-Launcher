const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const targetDir = path.join(rootDir, "dist-tauri");

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Copy HTML, CSS, JS frontend assets
["index.html", "index.css", "renderer.js"].forEach((file) => {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(targetDir, file));
  }
});

// Copy assets folder (icons, images)
const assetsSrc = path.join(rootDir, "assets");
const assetsDest = path.join(targetDir, "assets");
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
}

console.log("[Tauri] Synced web assets into dist-tauri/");
