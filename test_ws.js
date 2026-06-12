const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:8000/ws');
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'satellite_update') {
    console.log(msg.payload.satellites[0].position);
    process.exit(0);
  }
});
