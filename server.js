const express = require('express');
const http = require('http');
const { AccessToken } = require('livekit-server-sdk');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend web app

const livekitHost = process.env.LIVEKIT_WEBSOCKET_URL || 'wss://your-livekit-url.livekit.cloud';
const livekitApiKey = process.env.LIVEKIT_API_KEY || 'devkey';
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || 'secret';

// Endpoint to generate LiveKit tokens
app.post('/getToken', async (req, res) => {
  const { participantName, roomName } = req.body;
  if (!participantName || !roomName) {
    return res.status(400).json({ error: 'participantName and roomName are required' });
  }

  const at = new AccessToken(livekitApiKey, livekitApiSecret, {
    identity: participantName,
  });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  const tokenStr = await at.toJwt();
  res.json({ token: tokenStr, livekitUrl: livekitHost });
});

// WebSocket Server for custom signaling
const clients = new Map(); // ws -> participantName

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'register') {
        clients.set(ws, data.name);
        broadcastState();
      } else if (data.type === 'ring') {
        // Send a ring (Timbre) to a specific target
        const targetWs = [...clients.entries()].find(([c, name]) => name === data.target)?.[0];
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'ring', from: clients.get(ws) }));
        }
      } else {
        // Broadcast all other events (grito_start, grito_stop, whisper_sync, etc.) to all other clients
        for (const c of clients.keys()) {
          if (c !== ws && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(data));
          }
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastState();
  });
});

function broadcastState() {
  const users = Array.from(clients.values());
  for (const c of clients.keys()) {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify({ type: 'presence', users }));
    }
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
