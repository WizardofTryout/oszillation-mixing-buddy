#!/usr/bin/env node

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 48123;
let frameCount = 0;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Mixing Buddy Telemetry Receiver');
});

server.on('upgrade', (req, socket) => {
  console.log('🔗 WebSocket upgrade requested from:', req.url);

  const key = req.headers['sec-websocket-key'];
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));
  console.log('✅ Handshake complete! Listening for real-time telemetry from plugin...\n');

  socket.on('data', (buffer) => {
    frameCount++;
    // Minimal RFC 6455 unmasking for test receiver
    if (buffer.length < 6) return;
    const isMasked = (buffer[1] & 0x80) !== 0;
    let len = buffer[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      len = buffer.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      offset = 10;
    }

    if (!isMasked) return;
    const maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;

    const payload = Buffer.alloc(buffer.length - offset);
    for (let i = 0; i < payload.length; i++) {
      payload[i] = buffer[offset + i] ^ maskKey[i % 4];
    }

    try {
      const data = JSON.parse(payload.toString('utf8'));
      if (frameCount % 10 === 0) {
        console.log(`[Frame #${data.sequenceNumber}] ` +
          `Momentary: ${data.loudness.momentaryLufs.toFixed(1)} LUFS | ` +
          `Integrated: ${data.loudness.integratedLufs.toFixed(1)} LUFS | ` +
          `Peak: ${Math.max(data.loudness.truePeakDb.left, data.loudness.truePeakDb.right).toFixed(1)} dBTP | ` +
          `Correlation: ${data.dynamics.stereoCorrelation.toFixed(2)} | ` +
          `Resonances: ${data.spectrum.spectralResonances.length}`);
      }
    } catch {
      // Raw or partial chunk
    }
  });

  socket.on('close', () => {
    console.log('\n❌ Plugin disconnected from telemetry port.');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`📡 Mixing Buddy Telemetry Receiver listening on ws://127.0.0.1:${PORT}/meter`);
  console.log('👉 Start playback in Nuendo or Logic Pro with MixingBuddyMeter loaded on Master!\n');
});
