import { Room, RoomEvent, Track, ParticipantEvent } from 'https://esm.sh/livekit-client';

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
const appBody = document.getElementById('app');
const updateModal = document.getElementById('updateModal');

const LOCAL_VERSION = 'v41';

// --- Avatar & Color Logic ---
let selectedAvatarType = 'male';
let selectedColor = '#a855f7';

// Make sure to expose these to the global window object so HTML onClick can trigger them
window.selectAvatar = function(type) {
  selectedAvatarType = type;
  document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
  const el = document.getElementById(`opt-${type}`);
  if(el) el.classList.add('selected');
}

window.selectColor = function(color) {
  selectedColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  const el = document.getElementById(`color-${color}`);
  if(el) el.classList.add('selected');
}

const avatarSVGs = {
  male: '<svg class="w-full h-full p-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
  female: '<svg class="w-full h-full p-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path></svg>'
};

// Auto-select defaults
selectAvatar('male');
selectColor('#a855f7');

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
  
  const label = muteBtn.querySelector('.btn-label');
  const bars = document.querySelectorAll('.visualizer-bar');

  if (isMuted) {
    muteBtn.classList.remove('mic-on');
    muteBtn.classList.add('mic-off');
    if(label) {
      label.innerText = 'MIC OFF';
      label.classList.remove('text-white');
      label.classList.add('text-gray-500');
    }
    bars.forEach(b => b.classList.remove('bar-active'));
  } else {
    muteBtn.classList.remove('mic-off');
    muteBtn.classList.add('mic-on');
    if(label) {
      label.innerText = 'EN EL AIRE';
      label.classList.remove('text-gray-500');
      label.classList.add('text-white');
    }
    bars.forEach(b => b.classList.add('bar-active'));
  }
});

// 1. Initial State: Connect on Username
joinBtn.addEventListener('click', async () => {
  const val = usernameInput.value.trim();
  const pass = document.getElementById('passwordInput').value.trim();
  if (!val || !pass) {
    alert("Selecciona tu nombre e ingresa la contraseña.");
    return;
  }

  // Verify credentials on server
  try {
    const loginRes = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: val, password: pass })
    });
    const loginData = await loginRes.json();
    if (!loginData.success) {
      alert("⚠️ Contraseña incorrecta");
      return;
    }
  } catch (err) {
    console.error("Login Error:", err);
    return;
  }

  currentUser = val;
  currentUserDisplay.innerText = currentUser;
  
  // Apply visual styling
  const container = document.querySelector('header .w-10');
  if(container) {
    container.style.backgroundColor = selectedColor + '20';
    container.style.borderColor = selectedColor + '40';
    container.style.color = selectedColor;
    container.innerHTML = avatarSVGs[selectedAvatarType];
  }

  // Animation transition
  loginOverlay.style.opacity = '0';
  setTimeout(() => {
    loginOverlay.style.display = 'none';
    workspace.classList.remove('hidden', 'pointer-events-none');
    workspace.classList.add('opacity-100', 'translate-y-0');
  }, 700);
  
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

// Allow Enter key to join
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    joinBtn.click();
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
      if (data.version && data.version !== LOCAL_VERSION) {
        if (updateModal) updateModal.classList.remove('hidden');
        return; 
      }

      usersState = data.users.filter(u => u !== currentUser);
      userGroups = data.userGroups || {};
      
      // The server is the absolute source of truth. 
      // If the server says I am in a room, I am in a room.
      const serverMyGroup = userGroups[currentUser] || [];
      if (JSON.stringify(activeWhisperGroup) !== JSON.stringify(serverMyGroup)) {
         if (activeWhisperGroup.length === 0 && serverMyGroup.length > 1) {
             showToast(`🗣️ Te han unido a una Sub-sala.`);
         }
         activeWhisperGroup = serverMyGroup;
         if (room && room.localParticipant) {
             room.localParticipant.setMetadata(JSON.stringify(activeWhisperGroup));
         }
      }

      updateAllVolumes();
      renderUsers();
    } else if (data.type === 'ring') {
      playRingSound(data.from);
    } else if (data.type === 'grito_start') {
      gritoSender = data.from;
      activeWhisperGroup = [];
      if (room && room.localParticipant) room.localParticipant.setMetadata("[]");
      document.body.classList.add('grito-active');
      updateAllVolumes();
      renderUsers();
    } else if (data.type === 'grito_stop') {
      gritoSender = null;
      document.body.classList.remove('grito-active');
      updateAllVolumes();
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
      
      // iPad/iOS Failsafe: Force play after attach
      el.play().catch(e => console.warn("Playback blocked:", e));
      
      updateAllVolumes();
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

  // Background Sanity Check: Run every 2 seconds to ensure isolation is enforced
  setInterval(() => {
    updateAllVolumes();
  }, 2000);

  // Handle metadata changes for room sync
  const onMetadataChanged = (metadata, p) => {
    updateAllVolumes();
    renderUsers();
  };

  room.on(RoomEvent.ParticipantMetadataChanged, onMetadataChanged);
  
  // Attach listeners to EXISTING participants
  room.remoteParticipants.forEach((p) => {
    p.on(ParticipantEvent.MetadataChanged, onMetadataChanged);
  });

  room.on(RoomEvent.ParticipantConnected, (p) => {
    p.on(ParticipantEvent.MetadataChanged, onMetadataChanged);
    renderUsers();
  });
  room.on(RoomEvent.ParticipantDisconnected, () => {
    renderUsers();
  });
}

// 4. Mode Functions
// Zumbido (Timbre)
function triggerRing(targetUser) {
  safeWsSend({ type: 'ring', target: targetUser });
}

function playRingSound(from) {
  ringSound.play().catch(e => console.log("Sound play err:", e));
  showToast(`⚡️ ZUMBIDO urgente de: ${from}`);
  
  if (appBody) {
    appBody.classList.add('shake');
    setTimeout(() => appBody.classList.remove('shake'), 500);
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
    
    // THE MISSING LINK: Send room creation intent to the server!
    safeWsSend({ type: 'whisper_sync', from: currentUser, group: activeWhisperGroup });
    
    if (room && room.localParticipant) {
        room.localParticipant.setMetadata(JSON.stringify(activeWhisperGroup));
    }
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
    
    // Send leave intent to server!
    safeWsSend({ type: 'whisper_sync', from: currentUser, group: [] });
    
    if (room && room.localParticipant) {
        room.localParticipant.setMetadata(JSON.stringify([]));
    }
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
  if (room && room.localParticipant) {
      room.localParticipant.setMetadata(JSON.stringify([]));
  }
  
  const micPanel = document.getElementById('micPanel');
  if(micPanel) micPanel.classList.add('grito-active');
  
  const bars = document.querySelectorAll('.visualizer-bar');
  bars.forEach(b => b.classList.add('bar-active'));

  room.localParticipant.setMicrophoneEnabled(true); // Force Unmute Local
  
  updateAllVolumes();
  renderUsers();
}

function stopGrito() {
  safeWsSend({ type: 'grito_stop', from: currentUser });
  
  gritoSender = null;
  const micPanel = document.getElementById('micPanel');
  if(micPanel) micPanel.classList.remove('grito-active');
  
  // FIX: Restore the user's manual mute preference after releasing the Grito!
  if (!isMuted) {
     // Si no estaba muteado, dejamos las barras. Si estaba muteado, las quitamos.
  } else {
      const bars = document.querySelectorAll('.visualizer-bar');
      bars.forEach(b => b.classList.remove('bar-active'));
  }

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
  
  let track = null;
  let speakerGroup = [];

  if (room) {
    const p = (identity === currentUser) ? room.localParticipant : room.remoteParticipants.get(identity);
    if (p) {
      // Hardware track
      const pub = Array.from(p.audioTrackPublications.values())[0];
      if (pub && pub.audioTrack) track = pub.audioTrack;
      
      // Get room state from metadata (SOURCE OF TRUTH)
      if (p.metadata) {
          try {
              speakerGroup = JSON.parse(p.metadata);
          } catch(e) {}
      }
    }
  }

  function applyVol(v) {
    if (track) {
      // 1. Hardware WebRTC level
      if (track.setVolume) track.setVolume(v);
      
      // 2. DOM level (all attached elements)
      if (track.attachedElements) {
        track.attachedElements.forEach(el => {
          el.muted = (v <= 0);
          el.volume = v;
          // Security: force pause if muted to be 100% sure
          if (v <= 0) {
            el.pause(); 
          } else {
            el.play().catch(() => {});
          }
        });
      }
    }
  }

  // GLOBAL OVERRIDE: Grito (Shout)
  if (gritoSender) {
    if (identity === gritoSender) {
      applyVol(1.0);
    } else {
      applyVol(0.1);
    }
    return;
  }
  
  // ISOLATION LOGIC
  const speakerInPrivate = (speakerGroup && speakerGroup.length > 1);
  const meInPrivate = (activeWhisperGroup && activeWhisperGroup.length > 1);

  if (speakerInPrivate) {
    // If the speaker is in a private room, only their group hears them
    if (speakerGroup.includes(currentUser)) {
      applyVol(1.0);
    } else {
      applyVol(0.0);
    }
  } else {
    // Speaker is in General Office. 
    // Only people also in General Office hear them.
    if (meInPrivate) {
      applyVol(0.0);
    } else {
      applyVol(1.0);
    }
  }
}

function updateAllVolumes() {
  if (!room) return;
  try {
    const myId = currentUser;
    const meInPrivate = (activeWhisperGroup && activeWhisperGroup.length > 1);

    room.remoteParticipants.forEach(p => {
      // ONLY source of truth for remote state is userGroups from the Server!
      const speakerGroup = userGroups[p.identity] || [];
      const speakerInPrivate = (speakerGroup && speakerGroup.length > 1);
      
      let shouldHear = true;
      if (gritoSender) {
        shouldHear = true; 
      } else if (speakerInPrivate) {
        shouldHear = speakerGroup.includes(myId);
      } else {
        shouldHear = !meInPrivate;
      }

      p.audioTrackPublications.forEach(pub => {
        // Enforce subscription state
        if (pub.isSubscribed !== shouldHear) {
          pub.setSubscribed(shouldHear);
        }
        
        const track = pub.audioTrack;
        if (track) {
          if (shouldHear) {
            // Restore volume
            if (track.setVolume) track.setVolume(gritoSender && p.identity !== gritoSender ? 0.1 : 1.0);
            if (track.attachedElements) {
              track.attachedElements.forEach(el => {
                el.muted = false;
                el.volume = (gritoSender && p.identity !== gritoSender ? 0.1 : 1.0);
                el.play().catch(() => {});
              });
            }
          } else {
            // FORCE MUTE & PAUSE & DETACH
            if (track.setVolume) track.setVolume(0);
            if (track.attachedElements) {
              track.attachedElements.forEach(el => {
                el.muted = true;
                el.volume = 0;
                el.pause();
              });
            }
          }
        }
      });
    });
  } catch (err) {
    console.error("Global Audio Sync Error:", err);
  }
}

// Rendering UI
function renderUsers() {
  const allUsers = [currentUser, ...usersState];
  const userIntentions = {};
  
  // Use WebSocket state for visual grouping (Absolute Truth)
  allUsers.forEach(u => {
      let grp = userGroups[u];
      if (!grp || grp.length <= 1) grp = [u];
      userIntentions[u] = grp;
  });

  const roomsMap = {};
  Object.values(userIntentions).forEach(grp => {
    if (grp.length > 1) {
      const key = [...grp].sort().join(',');
      roomsMap[key] = [...new Set(grp)];
    }
  });
  
  const activeRooms = Object.values(roomsMap);
  const usersInSomeRoom = new Set(activeRooms.flat());

  // UI Tracing helper
  if (activeWhisperGroup && activeWhisperGroup.length > 0) {
    currentUserDisplay.innerText = `${currentUser}`;
    currentUserDisplay.innerHTML += `<br><span class="text-[9px] text-purple-400">🔒 Sala Privada</span>`;
  } else {
    currentUserDisplay.innerText = `${currentUser}`;
    currentUserDisplay.innerHTML += `<br><span class="text-[9px] text-gray-500">Oficina General</span>`;
  }

  // Clear DOM
  generalUserList.innerHTML = '';
  roomsContainer.innerHTML = '';

  // Tailwind SVG Icon Factory (simplified)
  const userIcon = `<svg class="w-6 h-6 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

  // Render General Office Users
  allUsers.forEach(user => {
    if (!usersInSomeRoom.has(user)) {
      const isMe = user === currentUser;
      const displayName = isMe ? 'Yo' : user;
      
      const actions = isMe ? '' : `
        <div class="flex gap-2">
          <button onclick="toggleWhisper('${user}')" class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-purple-500/20 transition-colors" title="Invitar a Privado">💬</button>
          <button onclick="triggerRing('${user}')" class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-yellow-500/20 text-yellow-400 transition-colors" title="Zumbido">⚡️</button>
        </div>
      `;

      const div = document.createElement('div');
      div.className = `user-item flex items-center justify-between p-4 glass rounded-[20px] transition-all ${isMe ? 'border border-purple-500/30 bg-purple-500/5' : ''}`;
      div.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center ${isMe ? 'text-purple-400' : ''}">
            ${userIcon}
          </div>
          <span class="text-sm font-bold ${isMe ? 'text-purple-400' : ''}">${displayName}</span>
        </div>
        ${actions}
      `;
      generalUserList.appendChild(div);
    }
  });

  // Render Active Rooms
  activeRooms.forEach(roomMem => {
    const isMyRoom = roomMem.includes(currentUser);
    const roomEl = document.createElement('div');
    roomEl.className = `glass rounded-[32px] p-6 border ${isMyRoom ? 'border-purple-500/50 bg-purple-500/[0.05]' : 'border-white/5 bg-white/[0.02]'}`;
    
    // Header
    let actionsHtml = '';
    if (isMyRoom) {
       actionsHtml = `<button class="w-full py-3 mt-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-[10px] font-black tracking-widest hover:bg-red-500/20 transition-all uppercase" onclick="leaveSubRoom()">❌ Salir de Sala</button>`;
    } else {
       const grpStr = encodeURIComponent(JSON.stringify(roomMem));
       actionsHtml = `<button class="w-full py-3 mt-4 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400 text-[10px] font-black tracking-widest hover:bg-purple-500/20 transition-all uppercase" onclick="requestJoin('${grpStr}')">✋ Toc Toc</button>`;
    }

    const avatarsHtml = roomMem.map(u => {
      const isMe = u === currentUser;
      const displayName = isMe ? 'Yo' : u;
      return `
      <div class="has-tooltip relative">
        <div class="w-10 h-10 rounded-full ${isMyRoom?'bg-purple-600':'bg-white/10'} border-2 border-[#08080a] flex items-center justify-center cursor-help ${isMe ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-[#08080a]' : ''}">
          <span class="text-xs font-bold">${displayName.substring(0,2).toUpperCase()}</span>
        </div>
        <div class="tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 glass rounded-xl p-3 text-center border border-white/10 z-50">
          <p class="text-[10px] font-bold mb-2">${displayName}</p>
          ${!isMe ? `<button onclick="triggerRing('${u}')" class="w-full bg-white/10 hover:bg-yellow-500/20 text-yellow-400 text-[9px] py-1 rounded-lg transition-all font-black uppercase">⚡️ Zumbido</button>` : ''}
        </div>
      </div>
      `;
    }).join('');

    roomEl.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-xs font-black truncate max-w-[150px]">${roomMem.join(', ')}</span>
          <span class="text-[10px] text-gray-500">${isMyRoom ? 'Tu Sala' : 'Ocupada'} • ${roomMem.length} miem.</span>
        </div>
        <div class="flex -space-x-3 items-center">
          ${avatarsHtml}
        </div>
      </div>
      ${actionsHtml}
    `;
    roomsContainer.appendChild(roomEl);
  });
}
window.triggerRing = triggerRing;
window.toggleWhisper = toggleWhisper;
