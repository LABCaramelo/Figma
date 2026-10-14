import fs from 'node:fs';
import path from 'node:path';

const asarPath = path.join(process.env.LOCALAPPDATA, 'Figma', 'app-126.10.7', 'resources', 'app.asar');
const unpackedPath = path.join(process.env.LOCALAPPDATA, 'Figma', 'app-126.10.7', 'resources', 'app.asar.unpacked');
const targetDir = path.resolve('d:/meus documentos/Figma/.figma-reference');

if (!fs.existsSync(asarPath)) {
  console.error('ASAR not found at', asarPath);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

const fd = fs.openSync(asarPath, 'r');
const prefixBuf = Buffer.alloc(16);
fs.readSync(fd, prefixBuf, 0, 16, 0);

const headerLength = prefixBuf.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerLength);
fs.readSync(fd, headerBuf, 0, headerLength, 16);

const header = JSON.parse(headerBuf.toString('utf8'));
// Header end: 16 bytes prefix + prefixBuf.readUInt32LE(8)
// Wait: byte 4 is total header payload size. byte 8 is pickle object size.
// In chromium pickle: total bytes following byte 8 is prefixBuf.readUInt32LE(4) (27804).
// So file data starts at 8 + 27804 = 27812.
const dataStart = 8 + prefixBuf.readUInt32LE(4);
console.log(`Header parsed, data start: ${dataStart}`);

let extractedFiles = 0;

function extract(entry, currentRel) {
  if (entry.files) {
    const dirPath = path.join(targetDir, currentRel);
    fs.mkdirSync(dirPath, { recursive: true });
    for (const [name, child] of Object.entries(entry.files)) {
      if (name === '.codesign') continue;
      extract(child, path.join(currentRel, name));
    }
  } else {
    const outPath = path.join(targetDir, currentRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (entry.unpacked) {
      const srcUnpacked = path.join(unpackedPath, currentRel);
      if (fs.existsSync(srcUnpacked)) {
        fs.copyFileSync(srcUnpacked, outPath);
        extractedFiles++;
      } else {
        console.warn('Unpacked file missing:', srcUnpacked);
      }
    } else {
      const offset = dataStart + parseInt(entry.offset, 10);
      const size = entry.size;
      const fileBuf = Buffer.alloc(size);
      if (size > 0) {
        fs.readSync(fd, fileBuf, 0, size, offset);
      }
      fs.writeFileSync(outPath, fileBuf);
      extractedFiles++;
    }
  }
}

extract(header, '');
fs.closeSync(fd);
console.log(`Successfully extracted ${extractedFiles} files to ${targetDir}`);
