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

const CURRENT_VERSION = 'v51'; // Auto-update to v51

const USER_DB = {
  "Alex": "1234",
  "Day": "1234",
  "Lau": "1234",
  "Thir": "1234"
};

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
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canUpdateOwnMetadata: true });

  const tokenStr = await at.toJwt();
  res.json({ token: tokenStr, livekitUrl: livekitHost });
});

// Endpoint for password verification
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (USER_DB[username] && USER_DB[username] === password) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Credenciales incorrectas' });
  }
});

// WebSocket Server for custom signaling
const clients = new Map(); // ws -> participantName
let globalUserGroups = {}; // PERSISTENCE: Store who is with whom on the server

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'register') {
        clients.set(ws, data.name);
        broadcastState();
      } else if (data.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } else if (data.type === 'ring') {
        // Send a ring (Timbre) to a specific target
        const targetWs = [...clients.entries()].find(([c, name]) => name === data.target)?.[0];
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'ring', from: clients.get(ws) }));
        }
      } else {
        if (data.type === 'whisper_sync') {
          if (data.group && data.group.length > 1) {
             data.group.forEach(m => globalUserGroups[m] = data.group);
          } else {
             // Leave group logic
             const oldGroup = globalUserGroups[data.from] || [];
             oldGroup.forEach(m => {
                 if (globalUserGroups[m]) {
                     globalUserGroups[m] = globalUserGroups[m].filter(u => u !== data.from);
                     if (globalUserGroups[m].length <= 1) delete globalUserGroups[m];
                 }
             });
             delete globalUserGroups[data.from];
          }
          broadcastState(); // Tell everyone IMMEDIATELY about the new state!
        } else if (data.type === 'grito_start') {
          globalUserGroups = {}; // Broadcast shout clears all rooms
          broadcastState();
          // Broadcast grito_start to others
          for (const c of clients.keys()) {
            if (c !== ws && c.readyState === WebSocket.OPEN) {
              c.send(JSON.stringify(data));
            }
          }
        } else {
          // Broadcast all other events (grito_stop, etc.) to other clients
          for (const c of clients.keys()) {
            if (c !== ws && c.readyState === WebSocket.OPEN) {
              c.send(JSON.stringify(data));
            }
          }
        }
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    const name = clients.get(ws);
    if (name) {
       const oldGroup = globalUserGroups[name] || [];
       oldGroup.forEach(m => {
           if (globalUserGroups[m]) {
               globalUserGroups[m] = globalUserGroups[m].filter(u => u !== name);
               if (globalUserGroups[m].length <= 1) delete globalUserGroups[m];
           }
       });
       delete globalUserGroups[name];
    }
    clients.delete(ws);
    broadcastState();
  });
});

function broadcastState() {
  const users = Array.from(clients.values());
  for (const c of clients.keys()) {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify({ 
        type: 'presence', 
        users,
        userGroups: globalUserGroups,
        version: CURRENT_VERSION // Send version to clients
      }));
    }
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
