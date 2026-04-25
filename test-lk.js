const { AccessToken } = require('livekit-server-sdk');
const dotenv = require('dotenv');

dotenv.config();

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const host = process.env.LIVEKIT_WEBSOCKET_URL;

console.log("Keys:", apiKey, apiSecret, host);

try {
  const at = new AccessToken(apiKey, apiSecret, {
    identity: 'test-user',
  });
  at.addGrant({ roomJoin: true, room: 'acoustic-office' });
  const token = at.toJwt();
  console.log("Token generated:", token);
} catch (err) {
  console.error("Token err", err);
}
