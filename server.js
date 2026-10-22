const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = require('http').createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 3;
const COURSE_HEIGHT = 4800;
const TICK_RATE = 30;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

function createRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function randomFromSeed(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createCourse(seed) {
  const random = randomFromSeed(seed);
  const hazardTypes = ['creature', 'urchin', 'barrel'];
  const obstacles = [];
  const boosts = [];

  for (let y = 300; y < COURSE_HEIGHT - 230; y += 115 + random() * 60) {
    obstacles.push({
      y,
      x: 128 + random() * 744,
      width: 64,
      height: 64,
      type: hazardTypes[Math.floor(random() * hazardTypes.length)],
    });
    if (random() > 0.43) {
      obstacles.push({
        y: y + 45 + random() * 40,
        x: 64 + random() * 808,
        width: 64,
        height: 64,
        type: hazardTypes[Math.floor(random() * hazardTypes.length)],
      });
    }
    if (random() > 0.62) boosts.push({ id: `b-${y}`, x: 80 + random() * 840, y: y + 20 + random() * 50, collected: false });
  }
  return { obstacles, boosts };
}

function playerState(socketId, playerId) {
  return { socketId, id: playerId, x: 500 + (playerId - 1) * 65, y: 90, speedX: 0, boostMs: 0, stunMs: 0, finished: false, finishTime: 0, input: { left: false, right: false } };
}

function roomState(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: [...room.players.values()].map(({ socketId, input, ...player }) => player),
    obstacles: room.course?.obstacles || [],
    boosts: room.course?.boosts || [],
  };
}

function sendRoomState(room) {
  io.to(room.code).emit('room-state', roomState(room));
}

function startRoom(room) {
  room.status = 'countdown';
  room.seed = Math.floor(Math.random() * 2 ** 32);
  room.course = createCourse(room.seed);
  for (const [socketId, player] of room.players) room.players.set(socketId, playerState(socketId, player.id));
  io.to(room.code).emit('race-countdown', { startAt: Date.now() + 3000 });
  setTimeout(() => {
    if (room.status !== 'countdown') return;
    room.status = 'racing';
    room.startedAt = Date.now();
    sendRoomState(room);
  }, 3000);
}

function overlaps(player, obstacle) {
  const radius = 20;
  return player.x + radius > obstacle.x && player.x - radius < obstacle.x + obstacle.width && player.y + radius > obstacle.y - obstacle.height / 2 && player.y - radius < obstacle.y + obstacle.height / 2;
}

function updateRoom(room, deltaMs) {
  if (room.status !== 'racing') return;
  for (const player of room.players.values()) {
    if (player.finished) continue;
    if (player.stunMs > 0) { player.stunMs -= deltaMs; continue; }
    const direction = (player.input.left ? -1 : 0) + (player.input.right ? 1 : 0);
    player.speedX += (direction * 4.8 - player.speedX) * 0.17;
    player.x = Math.max(30, Math.min(970, player.x + player.speedX * deltaMs * 0.08));
    player.y += (player.boostMs > 0 ? 0.23 : 0.135) * deltaMs;
    player.boostMs -= deltaMs;
    const hit = room.course.obstacles.find((obstacle) => overlaps(player, obstacle));
    if (hit) { player.stunMs = 950; player.y = Math.max(0, player.y - 65); player.boostMs = 0; continue; }
    for (const boost of room.course.boosts) {
      if (!boost.collected && Math.hypot(player.x - boost.x, player.y - boost.y) < 31) { boost.collected = true; player.boostMs = 1700; io.to(room.code).emit('boost-collected', boost.id); }
    }
    if (player.y >= COURSE_HEIGHT - 100) {
      player.finished = true;
      player.finishTime = Date.now() - room.startedAt;
      if (!room.winnerId) {
        room.winnerId = player.id;
        room.status = 'finished';
        io.to(room.code).emit('race-finished', { winnerId: player.id, players: roomState(room).players });
      }
    }
  }
  sendRoomState(room);
}

io.on('connection', (socket) => {
  socket.on('create-room', () => {
    const code = createRoomCode();
    const room = { code, hostId: socket.id, status: 'lobby', players: new Map([[socket.id, playerState(socket.id, 0)]]) };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('joined-room', { code, playerId: 0, isHost: true });
    sendRoomState(room);
  });

  socket.on('join-room', ({ code }) => {
    const room = rooms.get(String(code).trim().toUpperCase());
    if (!room || room.status !== 'lobby') return socket.emit('join-error', 'That room does not exist or the race already started.');
    if (room.players.size >= MAX_PLAYERS) return socket.emit('join-error', 'That room is full.');
    const id = room.players.size;
    room.players.set(socket.id, playerState(socket.id, id));
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit('joined-room', { code: room.code, playerId: id, isHost: false });
    sendRoomState(room);
  });

  socket.on('start-race', () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.hostId === socket.id && room.status === 'lobby') startRoom(room);
  });

  socket.on('player-input', (input) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    if (room?.status === 'racing' && player) player.input = { left: Boolean(input.left), right: Boolean(input.right) };
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) rooms.delete(room.code);
    else { if (room.hostId === socket.id) room.hostId = room.players.keys().next().value; sendRoomState(room); }
  });

});

let previousTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const delta = Math.min(50, now - previousTick);
  previousTick = now;
  rooms.forEach((room) => updateRoom(room, delta));
}, 1000 / TICK_RATE);

server.listen(PORT, () => console.log(`Dive and Dash listening on port ${PORT}`));
