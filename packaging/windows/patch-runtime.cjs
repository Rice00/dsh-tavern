// Desktop 2.0.5 writes UTF-8 .cmd files but cmd.exe may read them as GBK/OEM.
// Apply only inside a newly extracted runtime, before writing its ready marker.
const fs = require('original-fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = path.resolve(process.argv[2]);
const moduleName = 'desktop-runtime-environment.js';
const filename = path.join(runtime, 'resources', 'app.asar.unpacked', 'lib', moduleName);
const original = fs.readFileSync(filename, 'utf8');
const marker = '"@echo off",';
if (original.split(marker).length !== 4) throw Error('Unexpected Desktop Windows command templates');
const content = Buffer.from(original.replaceAll(marker, '"@chcp 65001>nul",\n\t\t"@echo off",'), 'utf8');
const archive = path.join(runtime, 'resources', 'app.asar');
const bytes = fs.readFileSync(archive);
const oldHeaderSize = bytes.readUInt32LE(4);
const header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)).toString('utf8'));
const entry = header.files.lib.files[moduleName];
if (!entry.unpacked) throw Error('Desktop runtime module is not unpacked');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
entry.size = content.length;
const blockSize = entry.integrity?.blockSize || 4194304;
entry.integrity = {
  algorithm: 'SHA256', hash: digest(content), blockSize,
  blocks: Array.from({ length: Math.ceil(content.length / blockSize) }, (_, i) => digest(content.subarray(i * blockSize, (i + 1) * blockSize))),
};
const json = Buffer.from(JSON.stringify(header), 'utf8');
const body = Buffer.alloc(Math.ceil((4 + json.length) / 4) * 4);
body.writeUInt32LE(json.length, 0); json.copy(body, 4);
const pickle = Buffer.alloc(4 + body.length);
pickle.writeUInt32LE(body.length, 0); body.copy(pickle, 4);
const size = Buffer.alloc(8); size.writeUInt32LE(4, 0); size.writeUInt32LE(pickle.length, 4);
fs.writeFileSync(filename, content);
fs.writeFileSync(archive, Buffer.concat([size, pickle, bytes.subarray(8 + oldHeaderSize)]));
