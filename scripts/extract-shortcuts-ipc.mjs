import fs from 'node:fs';

const mainJs = fs.readFileSync('d:/meus documentos/Figma/.figma-reference/main.js', 'utf8');

// Search for accelerator strings like accelerator: "..."
const accelerators = new Set();
const accRegex = /accelerator:\s*["']([^"']+)["']/g;
let m;
while ((m = accRegex.exec(mainJs)) !== null) {
  accelerators.add(m[1]);
}

// Search for globalShortcut.register or shortcuts
const globRegex = /register\(\s*["']([^"']+)["']/g;
while ((m = globRegex.exec(mainJs)) !== null) {
  accelerators.add(m[1]);
}

console.log('Accelerators found in main.js:', Array.from(accelerators).sort());

// Search for ipcMain channels
const ipcChannels = new Set();
const ipcRegex = /ipcMain\.(?:on|handle)\(\s*["']([^"']+)["']/g;
while ((m = ipcRegex.exec(mainJs)) !== null) {
  ipcChannels.add(m[1]);
}
console.log('IPC Channels in main.js:', Array.from(ipcChannels).sort());
