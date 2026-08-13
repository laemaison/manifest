// Builds a fully self-contained index.html:
//   - React + ReactDOM inlined (no unpkg fetch)
//   - JSX pre-compiled with the classic runtime (no 3MB Babel at runtime)
// Run from the build/ directory: node build.js

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "src", "app.html");
const OUT = path.join(root, "index.html");

const OPEN = '<script type="text/babel" data-presets="react-classic">';
const CLOSE = "</script>";

const html = fs.readFileSync(SRC, "utf8");

const start = html.indexOf(OPEN);
if (start === -1) throw new Error("Could not find the babel script tag in src/app.html");
const bodyStart = start + OPEN.length;
const bodyEnd = html.indexOf(CLOSE, bodyStart);
if (bodyEnd === -1) throw new Error("Unterminated babel script tag");

const jsx = html.slice(bodyStart, bodyEnd);

const { code } = babel.transformSync(jsx, {
  presets: [[require("@babel/preset-react"), { runtime: "classic" }]],
  compact: false,
  babelrc: false,
  configFile: false,
});

if (/\bReact\.createElement\b/.test(code) === false) {
  throw new Error("Compiled output has no React.createElement — wrong runtime?");
}
if (/^\s*import\s/m.test(code)) {
  throw new Error("Compiled output contains an ESM import — wrong runtime?");
}

const react = fs.readFileSync(path.join(__dirname, "react.js"), "utf8");
const reactDom = fs.readFileSync(path.join(__dirname, "react-dom.js"), "utf8");

// Replace the three CDN script tags with inlined libraries.
const head = html.slice(0, start);
const tail = html.slice(bodyEnd + CLOSE.length);

const cdnBlock =
  /<script crossorigin src="https:\/\/unpkg\.com\/react@[^"]*"><\/script>\s*<script crossorigin src="https:\/\/unpkg\.com\/react-dom@[^"]*"><\/script>\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"><\/script>\s*<script>[\s\S]*?<\/script>/;

if (!cdnBlock.test(head)) throw new Error("Could not locate the CDN script block to replace");

const inlined =
  "<script>" + react + "</script>\n" +
  "<script>" + reactDom + "</script>";

// Must use a replacer function: React's minified source contains `$$typeof`,
// and `$` sequences in a replacement *string* are interpreted as capture-group
// references, which silently corrupts the inlined library.
const newHead = head.replace(cdnBlock, () => inlined);

let out = newHead + "<script>\n" + code + "\n</script>" + tail;

const banner =
  "\n<!-- GENERATED FILE - do not edit by hand.\n" +
  "     Source: src/app.html   Build: cd build && node build.js -->";
out = out.replace(/(<!DOCTYPE html>)/i, (m) => m + banner);

if (/unpkg\.com/.test(out)) throw new Error("unpkg reference survived the build");

fs.writeFileSync(OUT, out);
console.log("built index.html:", (out.length / 1024).toFixed(0) + "KB");
console.log("external scripts remaining:", (out.match(/<script[^>]*\ssrc=/g) || []).length);
