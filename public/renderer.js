import { Room, RoomEvent, Track } from 'https://esm.sh/livekit-client';

// DOM Elements
const loginOverlay = document.getElementById('loginOverlay');
const workspace = document.getElementById('workspace');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const muteBtn = document.getElementById('muteBtn'); // NEW: Mute Button
const currentUserDisplay = document.getElementById('currentUserDisplay');
const generalUserList = document.getElementById('generalUserList');
const roomsContainer = document.getElementById('roomsContainer');
const gritoBtn = document.getElementById('gritoBtn');
const ringSound = document.getElementById('ringSound');
const audioElements = document.getElementById('audioElements');
const audioVisualizer = document.querySelector('.audio-visualizer');
const toastNotification = document.getElementById('toastNotification');
const toastMessage = document.getElementById('toastMessage');

let toastTimeout;
function showToast(msg) {
  toastMessage.innerText = msg;
  toastNotification.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastNotification.classList.add('hidden');
  }, 4000);
}

// Synthetic Knock Sound (No external asset needed)
function playKnockSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    for(let i=0; i<3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(150, t + i*0.2);
      osc.frequency.exponentialRampToValueAtTime(40, t + i*0.2 + 0.1);
      gain.gain.setValueAtTime(1, t + i*0.2);
      gain.gain.exponentialRampToValueAtTime(0.01, t + i*0.2 + 0.1);
      osc.start(t + i*0.2);
      osc.stop(t + i*0.2 + 0.1);
    }
  } catch(e) { console.error("Audio synth error", e); }
}

const joinModal = document.getElementById('joinModal');
const joinModalText = document.getElementById('joinModalText');
const acceptJoinBtn = document.getElementById('acceptJoinBtn');
const rejectJoinBtn = document.getElementById('rejectJoinBtn');
let pendingJoinRequest = null;

acceptJoinBtn.addEventListener('click', () => {
  if (pendingJoinRequest) {
    if (!activeWhisperGroup.includes(pendingJoinRequest)) {
      activeWhisperGroup.push(pendingJoinRequest);
      userGroups[currentUser] = activeWhisperGroup;
      safeWsSend({ type: 'whisper_sync', from: currentUser, group: activeWhisperGroup });
      updateAllVolumes();
      renderUsers();
    }
  }
  joinModal.classList.add('hidden');
  pendingJoinRequest = null;
});

rejectJoinBtn.addEventListener('click', () => {
  joinModal.classList.add('hidden');
  pendingJoinRequest = null;
});

let currentUser = '';
const roomName = 'ofivoz-main';
let ws;
let room;
let usersState = [];
let myMicTrack = null;

// States
let activeWhisperGroup = []; // Array of participants currently in a private sub-room
let userGroups = {}; // Dictionary tracking what group each remote participant claims to be in
let gritoSender = null; // null if passive, or holds the username of the person shouting

// Mute logic
let isMuted = true; // START MUTED BY DEFAULT
muteBtn.addEventListener('click', async () => {
  if (!room) return;
  isMuted = !isMuted;
  
  try {
    await room.localParticipant.setMicrophoneEnabled(!isMuted);
    await room.startAudio(); // Safety net gesture catch
  } catch(e) {}
  
  if (isMuted) {
    muteBtn.innerHTML = '<span>🔇 MIC OFF</span>';
    muteBtn.classList.add('muted');
    audioVisualizer.classList.remove('visualizer-active');
  } else {
    muteBtn.innerHTML = '<span>🎤 MIC ON</span>';
    muteBtn.classList.remove('muted');
    audioVisualizer.classList.add('visualizer-active');
  }
});

// 1. Initial State: Connect on Username
joinBtn.addEventListener('click', async () => {
  const val = usernameInput.value.trim();
  if (!val) return;
  currentUser = val;
  currentUserDisplay.innerText = currentUser;
  
  loginOverlay.classList.remove('active');
  workspace.style.display = 'flex';
  
  // Create room synchronously to capture User Gesture for Safari Audio
  room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: { autoGainControl: true, echoCancellation: true, noiseSuppression: true }
  });
  room.startAudio().catch(e => console.log('Audio autoplay prevented'));

  await connectSignaling();
  try {
    await connectLiveKit();
  } catch (error) {
    console.error("LiveKit Falló:", error);
  }
});

// 2. WebSocket Signaling (Timbre, Grito overriding)
// Safe WS send
function safeWsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  } else {
    console.warn("WS disconnected, cannot send", obj);
  }
}

async function connectSignaling() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    safeWsSend({ type: 'register', name: currentUser });
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'presence') {
      usersState = data.users.filter(u => u !== currentUser);
      renderUsers();
    } else if (data.type === 'ring') {
      playRingSound(data.from);
    } else if (data.type === 'grito_start') {
      gritoSender = data.from;
      // Destruir todas las subsalas privadas inmediatamente
      activeWhisperGroup = [];
      userGroups = {}; 
      document.body.classList.add('grito-active');
      updateAllVolumes();
      renderUsers();
    } else if (data.type === 'grito_stop') {
      gritoSender = null;
      document.body.classList.remove('grito-active');
      updateAllVolumes();
    } else if (data.type === 'whisper_sync') {
      userGroups[data.from] = data.group;
      
      let changed = false;
      if (data.group.includes(currentUser)) {
        if (JSON.stringify(activeWhisperGroup) !== JSON.stringify(data.group)) {
          // If group changes and it's not from ME, it means someone else modified the room I am in
          if (data.from !== currentUser && activeWhisperGroup.length < data.group.length) {
             showToast(`🗣️ ${data.from} modificó la Sub-sala.`);
          }
          activeWhisperGroup = data.group;
          changed = true;
        }
      } else if (activeWhisperGroup.includes(data.from)) {
        if (!data.group.includes(currentUser)) {
          showToast(`🚪 ${data.from} salió de la Sub-sala.`);
          activeWhisperGroup = activeWhisperGroup.filter(u => u !== data.from);
          if (activeWhisperGroup.length <= 1) {
            activeWhisperGroup = [];
          }
          changed = true;
        }
      }
      
      if (changed) {
        userGroups[currentUser] = activeWhisperGroup;
        // Broadcast my adoption of the room state so everyone mutes me appropriately
        safeWsSend({ type: 'whisper_sync', from: currentUser, group: activeWhisperGroup });
      }
      
      updateAllVolumes();
      renderUsers();
    } else if (data.type === 'request_join' && data.to === currentUser) {
      playKnockSound();
      pendingJoinRequest = data.from;
      joinModalText.innerText = `✋ ${data.from} solicita unirse a tu Sub-sala. ¿Permitir?`;
      joinModal.classList.remove('hidden');
    }
  };
}

// 3. LiveKit Audio Engine
async function connectLiveKit() {
  // Room is already instantiated in click handler
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.id = `audio-${participant.identity}`;
      audioElements.appendChild(el);
      adjustVolume(participant.identity);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      track.detach();
      const el = document.getElementById(`audio-${participant.identity}`);
      if (el) el.remove();
    }
  });

  // Get Token from backend
  const res = await fetch('/getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantName: currentUser, roomName })
  });
  const { token, livekitUrl } = await res.json();

  if (livekitUrl.includes('your-livekit-url')) {
    throw new Error('LiveKit URL not configured in backend');
  }

  await room.connect(livekitUrl, token);
  
  try {
    await room.localParticipant.setMicrophoneEnabled(false); 
  } catch (micErr) {
    console.warn("Error micro:", micErr);
  }

  // Ensure browser allows autoplay
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) {
      room.startAudio().catch(console.error);
    }
  });
  
  // Visualizer FX
  audioVisualizer.classList.add('visualizer-active');
}

// 4. Mode Functions
// Zumbido (Timbre)
function triggerRing(targetUser) {
  safeWsSend({ type: 'ring', target: targetUser });
}

function playRingSound(from) {
  ringSound.play().catch(e => console.log("Sound play err:", e));
  showToast(`📳 ZUMBIDO urgente de: ${from}`);
  
  const app = document.getElementById('app');
  if (app) {
    app.classList.add('shake');
    setTimeout(() => app.classList.remove('shake'), 600);
  }
}

// Whisper State (Sub-rooms)
function toggleWhisper(targetUser) {
  try {
    if (activeWhisperGroup.length === 0) {
      activeWhisperGroup = [currentUser, targetUser];
    } else {
      if (activeWhisperGroup.includes(targetUser)) {
        activeWhisperGroup = activeWhisperGroup.filter(u => u !== targetUser);
      } else {
        activeWhisperGroup.push(targetUser);
      }
    }
    
    if (activeWhisperGroup.length <= 1) {
      activeWhisperGroup = [];
    }
    
    userGroups[currentUser] = activeWhisperGroup;
    safeWsSend({ type: 'whisper_sync', from: currentUser, group: activeWhisperGroup });
    updateAllVolumes();
    renderUsers();
  } catch (err) {
    console.error("Globito Error:", err);
  }
}

// Request Join
function requestJoin(targetUserObjStr) {
  try {
    const groupArr = JSON.parse(decodeURIComponent(targetUserObjStr));
    // Pick the first person in that group to send the request to
    const leader = groupArr.find(u => u !== currentUser);
    if (leader) safeWsSend({ type: 'request_join', from: currentUser, to: leader });
    showToast(`⏳ Solicitud enviada a la sala de ${leader}...`);
  } catch (e) { console.error(e); }
}

window.requestJoin = requestJoin;
// Handle clear (Leave Sub-room) globally
window.leaveSubRoom = function() {
  try {
    activeWhisperGroup = [];
    userGroups[currentUser] = [];
    safeWsSend({ type: 'whisper_sync', from: currentUser, group: activeWhisperGroup });
    updateAllVolumes();
    renderUsers();
  } catch (err) {
    console.error("Leave Button Error:", err);
  }
};

// Grito
function startGrito() {
  safeWsSend({ type: 'grito_start', from: currentUser });
  
  gritoSender = currentUser;
  activeWhisperGroup = [];
  userGroups = {};
  
  document.body.classList.add('grito-active');
  gritoBtn.classList.add('active');
  room.localParticipant.setMicrophoneEnabled(true); // Force Unmute Local
  
  updateAllVolumes();
  renderUsers();
}

function stopGrito() {
  safeWsSend({ type: 'grito_stop', from: currentUser });
  
  gritoSender = null;
  document.body.classList.remove('grito-active');
  gritoBtn.classList.remove('active');
  
  // FIX: Restore the user's manual mute preference after releasing the Grito!
  if (room && room.localParticipant) {
    room.localParticipant.setMicrophoneEnabled(!isMuted);
  }
  
  updateAllVolumes();
}

// Listen to Keyboard Shortcut from the Browser (e.g. Ctrl + Shift + Space)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    if (!gritoSender) startGrito();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { // If they release space, stop grito
    if (gritoSender === currentUser) stopGrito();
  }
});

// UI Triggers for Grito
gritoBtn.addEventListener('mousedown', startGrito);
gritoBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startGrito(); }, { passive: false });
gritoBtn.addEventListener('mouseup', stopGrito);
gritoBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopGrito(); });
gritoBtn.addEventListener('mouseleave', () => { if (gritoSender === currentUser) stopGrito() });

// Volume Matrix Logic
function adjustVolume(identity) {
  const el = document.getElementById(`audio-${identity}`);
  
  // Attempt to grab the native LiveKit WebRTC track for hardware-level volume control
  let track = null;
  if (room && room.remoteParticipants) {
    const p = room.remoteParticipants.get(identity);
    if (p) {
      const pub = Array.from(p.audioTrackPublications.values())[0];
      if (pub && pub.audioTrack) track = pub.audioTrack;
    }
  }

  function applyVol(v) {
    if (el) {
      el.muted = (v <= 0);
      el.volume = v;
    }
    if (track) {
      track.setVolume(v); // LiveKit level hardware override!
    }
  }

  if (gritoSender) {
    if (identity === gritoSender) {
      applyVol(1.0); // Solo la persona que está gritando se escucha al 100%
    } else {
      applyVol(0.1); // Todos los demás bajan al 10%
    }
    return;
  }
  
  const speakerGroup = userGroups[identity] || [];
  
  if (speakerGroup.length > 0) {
    // The speaker is in a sub-room!
    if (speakerGroup.includes(currentUser)) {
      applyVol(1.0);
    } else {
      applyVol(0.0); // Hardware native mute via LiveKit SetVolume!
    }
  } else {
    // The speaker is talking to the general room.
    if (activeWhisperGroup.length > 0) {
      applyVol(0.1); // I am in a sub-room, so the general room is 10% environmental noise
    } else {
      applyVol(1.0); // We are both in the open room
    }
  }
}

function updateAllVolumes() {
  try {
    if (room && room.remoteParticipants) {
      Array.from(room.remoteParticipants.values()).forEach(p => {
        adjustVolume(p.identity);
      });
    } else if (room && room.participants) {
      room.participants.forEach(p => { // Fallback map
        adjustVolume(p.identity);
      });
    }
  } catch (err) {
    console.error("Volume Error:", err);
  }
}

// Rendering UI
function renderUsers() {
  // Aggregate all unique sub-rooms
  const myGrp = activeWhisperGroup.length > 0 ? activeWhisperGroup : [currentUser];
  const userIntentions = { [currentUser]: myGrp };
  
  usersState.forEach(u => {
    userIntentions[u] = userGroups[u] && userGroups[u].length > 0 ? userGroups[u] : [u];
  });

  const roomsMap = {};
  Object.values(userIntentions).forEach(grp => {
    if (grp.length > 1) { // It's a sub-room!
      const key = [...grp].sort().join(',');
      roomsMap[key] = [...new Set(grp)]; // unique members
    }
  });
  
  const activeRooms = Object.values(roomsMap);
  const usersInSomeRoom = new Set(activeRooms.flat());

  // UI Tracing helper
  if (activeWhisperGroup.length > 0) {
    currentUserDisplay.innerText = `${currentUser} (🔒 Sala)`;
    currentUserDisplay.style.color = 'var(--whisper-color)';
  } else {
    currentUserDisplay.innerText = currentUser + " (Oficina General)";
    currentUserDisplay.style.color = '';
  }

  // Clear DOM
  generalUserList.innerHTML = '';
  roomsContainer.innerHTML = '';

  // Render General Office Users (people who are NOT in any active sub-room)
  usersState.forEach(user => {
    if (!usersInSomeRoom.has(user)) {
      const li = document.createElement('li');
      li.className = 'user-item glass-panel';
      li.innerHTML = `
        <div class="user-info">
          <div class="avatar">${user.substring(0, 2).toUpperCase()}</div>
          <span>${user}</span>
        </div>
        <div class="user-actions">
          <button type="button" class="icon-btn ring" onclick="triggerRing('${user}')" title="Enviar Zumbido">📳</button>
          <button type="button" class="icon-btn whisper" onclick="toggleWhisper('${user}')" title="Llamar a Privado">💬</button>
        </div>
      `;
      generalUserList.appendChild(li);
    }
  });

  // Render Active Rooms
  activeRooms.forEach(roomMem => {
    const isMyRoom = roomMem.includes(currentUser);
    const roomEl = document.createElement('div');
    roomEl.className = 'room-cluster glass-panel mt-2';
    roomEl.style.borderColor = isMyRoom ? 'var(--whisper-color)' : 'var(--glass-border)';
    
    // Header
    const roomTitle = `Sala: ${roomMem.join(', ')}`;
    let actionsHtml = '';
    
    if (isMyRoom) {
       actionsHtml = `<button class="btn text-btn" style="color: var(--alert-color); border: 1px solid var(--alert-color); padding: 4px; font-size: 0.8rem;" onclick="leaveSubRoom()">❌ Salir</button>`;
    } else {
       const grpStr = encodeURIComponent(JSON.stringify(roomMem));
       actionsHtml = `<button class="btn primary-btn" style="padding: 4px; font-size: 0.8rem;" onclick="requestJoin('${grpStr}')">✋ Toc Toc...</button>`;
    }

    // Members avatars with Zumbido button
    const avatarsHtml = roomMem.map(u => `
      <div style="display:flex; flex-direction:column; align-items:center;">
        <div class="avatar" style="width:30px; height:30px; font-size:0.7rem; border:2px solid ${isMyRoom?'var(--whisper-color)':'#fff'};" title="${u}">${u.substring(0, 2).toUpperCase()}</div>
        <span style="font-size:0.7rem; margin-top:4px;">${u}</span>
        ${u !== currentUser ? `<button type="button" class="icon-btn ring" style="width:24px; height:24px; font-size:0.7rem; margin-top:2px;" onclick="triggerRing('${u}')" title="Zumbido">📳</button>` : ''}
      </div>
    `).join('');

    roomEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span style="font-size: 0.85rem; font-weight: bold; color: ${isMyRoom?'var(--whisper-color)':'var(--text-secondary)'}">${roomTitle}</span>
        ${actionsHtml}
      </div>
      <div style="display:flex; gap: 8px;">
        ${avatarsHtml}
      </div>
    `;
    roomsContainer.appendChild(roomEl);
  });
}
window.triggerRing = triggerRing;
window.toggleWhisper = toggleWhisper;
