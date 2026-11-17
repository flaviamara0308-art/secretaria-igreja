import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Generate icon.svg
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e3a8a" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="crossGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
  </defs>
  <!-- Background with rounded corners -->
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)" />
  
  <!-- Subtle border highlight -->
  <rect x="8" y="8" width="496" height="496" rx="104" fill="none" stroke="#3b82f6" stroke-width="4" stroke-opacity="0.3" />

  <!-- Church building structure silhouette -->
  <path d="M120 400 L120 280 L256 160 L392 280 L392 400 Z" fill="#1e293b" fill-opacity="0.8" />
  
  <!-- Central Arch Gate -->
  <path d="M216 400 L216 310 C216 288 296 288 296 310 L296 400 Z" fill="#0f172a" />
  
  <!-- Sacred Latin Cross (emblem of Church Administration) -->
  <rect x="238" y="100" width="36" height="150" rx="8" fill="url(#crossGrad)" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.4))" />
  <rect x="190" y="140" width="132" height="36" rx="8" fill="url(#crossGrad)" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.4))" />
  
  <!-- Radiant Aura / Book base representing Records / Secretaria -->
  <path d="M150 400 C180 380 230 385 256 395 C282 385 332 380 362 400 L370 415 C335 395 285 400 256 410 C227 400 177 395 142 415 Z" fill="url(#goldGrad)" />
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf8');

// Function to generate raw uncompressed PNG buffer using standard node zlib
function createSolidPng(width, height, r, g, b, a = 255) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw image data with scanlines (filter byte 0 per line)
  const lineLength = width * 4 + 1;
  const rawData = Buffer.alloc(lineLength * height);

  for (let y = 0; y < height; y++) {
    const lineOffset = y * lineLength;
    rawData[lineOffset] = 0; // Filter byte 0 (None)
    for (let x = 0; x < width; x++) {
      const pxOffset = lineOffset + 1 + x * 4;
      // Church blue background with gold/white cross pattern
      const isCrossY = (y > height * 0.2 && y < height * 0.7 && Math.abs(x - width / 2) < width * 0.06);
      const isCrossX = (y > height * 0.32 && y < height * 0.44 && Math.abs(x - width / 2) < width * 0.22);
      
      if (isCrossY || isCrossX) {
        rawData[pxOffset] = 255; // White cross
        rawData[pxOffset + 1] = 255;
        rawData[pxOffset + 2] = 255;
        rawData[pxOffset + 3] = 255;
      } else {
        // Gradient dark blue
        const t = y / height;
        rawData[pxOffset] = Math.round(30 * (1 - t) + 15 * t);
        rawData[pxOffset + 1] = Math.round(58 * (1 - t) + 23 * t);
        rawData[pxOffset + 2] = Math.round(138 * (1 - t) + 42 * t);
        rawData[pxOffset + 3] = 255;
      }
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const chunk = Buffer.alloc(12 + length);
  chunk.writeUInt32BE(length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, 8 + length));
  chunk.writeUInt32BE(crc, 8 + length);
  return chunk;
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Generate PWA icons
const pwa192 = createSolidPng(192, 192, 30, 58, 138);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), pwa192);

const pwa512 = createSolidPng(512, 512, 30, 58, 138);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), pwa512);

const pwaMaskable = createSolidPng(512, 512, 30, 58, 138);
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), pwaMaskable);

const appleIcon = createSolidPng(180, 180, 30, 58, 138);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleIcon);

const favicon = createSolidPng(32, 32, 30, 58, 138);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favicon);

console.log('PWA icons and SVG generated successfully in /public!');
