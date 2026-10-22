const $ = (selector) => document.querySelector(selector);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const COURSE_HEIGHT = 4800;

const FISH_COLORS = ['#55dfff', '#ff7ab9', '#ffe15a'];
const FISH_NAMES = ['Blue', 'Pink', 'Gold'];

const socket = io();
const images = {};

['east', 'hazard-creature', 'hazard-urchin', 'hazard-barrel', 'boost-bubble', 'finish_line']
  .forEach((name) => {
    images[name] = new Image();
    images[name].src = `assets/${name}.png`;
  });

let roomCode = '';
let myPlayerId = null;
let isHost = false;
let gameState = { players: [], obstacles: [], boosts: [], status: 'lobby' };
let countdownTimer = null;
let animationActive = false;

let practiceMode = false;
let practiceLastFrame = 0;

const input = { left: false, right: false };

function showScreen(id) {
  ['menu', 'lobby', 'how', 'game', 'results'].forEach((screen) => {
    $(`#${screen}`).classList.toggle('active', screen === id);
  });
}

function spriteReady(image) {
  return image?.complete && image.naturalWidth > 0;
}

function sendInput() {
  socket.emit('player-input', input);
}

function updateLobby() {
  $('#lobbyCode').textContent = roomCode;

  const playerCount = gameState.players.length;
  $('#lobbyText').textContent = `${playerCount}/3 fish ready to race`;

  $('#lobbyPlayers').innerHTML = gameState.players.map((player) => `
    <div class="lobby-player" style="--fish-color:${FISH_COLORS[player.id]}">
      <span>🐟</span>
      <b>Player ${player.id + 1}</b>
      ${player.id === myPlayerId ? ' (You)' : ''}
    </div>
  `).join('');

  $('#startRace').style.display = isHost ? 'inline-block' : 'none';

  $('#hostNote').textContent = isHost
    ? 'You are the host. Start when everyone has joined.'
    : 'Waiting for the host to start the race.';
}

socket.on('joined-room', ({ code, playerId, isHost: host }) => {
  roomCode = code;
  myPlayerId = playerId;
  isHost = host;
  showScreen('lobby');
});

socket.on('join-error', (message) => {
  $('#menuError').textContent = message;
});

socket.on('room-state', (state) => {
  if (practiceMode) return;

  gameState = state;

  if (state.status === 'lobby') {
    updateLobby();
  }

  if (state.status === 'racing' && !animationActive) {
    showScreen('game');
    animationActive = true;
    requestAnimationFrame(renderLoop);
  }
});

socket.on('race-countdown', ({ startAt }) => {
  if (practiceMode) return;

  showScreen('game');

  const tick = () => {
    const seconds = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
    $('#countdown').textContent = seconds > 0 ? seconds : 'GO!';

    if (seconds > 0) {
      countdownTimer = setTimeout(tick, 100);
    } else {
      setTimeout(() => {
        $('#countdown').textContent = '';
      }, 600);
    }
  };

  clearTimeout(countdownTimer);
  tick();
});

socket.on('race-finished', ({ winnerId, players }) => {
  if (practiceMode) return;

  animationActive = false;

  const ordered = [...players].sort(
    (a, b) => (a.finishTime || Infinity) - (b.finishTime || Infinity)
  );

  $('#winner').textContent = winnerId === myPlayerId
    ? 'You Win!'
    : `${FISH_NAMES[winnerId]} Fish Wins!`;

  $('#rankings').innerHTML = ordered.map((player, index) => `
    <div class="rank">
      <span>${['🥇', '🥈', '🥉'][index]} Player ${player.id + 1}</span>
      <span>${player.finishTime ? `${(player.finishTime / 1000).toFixed(1)}s` : '—'}</span>
    </div>
  `).join('');

  setTimeout(() => showScreen('results'), 750);
});

function circle(x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function createPracticeCourse() {
  const hazardTypes = ['creature', 'urchin', 'barrel'];
  const obstacles = [];
  const boosts = [];

  for (let y = 300; y < COURSE_HEIGHT - 230; y += 120 + Math.random() * 50) {
    obstacles.push({
      y,
      x: 128 + Math.random() * 744,
      width: 64,
      height: 64,
      type: hazardTypes[Math.floor(Math.random() * hazardTypes.length)],
    });

    if (Math.random() > 0.45) {
      obstacles.push({
        y: y + 45 + Math.random() * 40,
        x: 64 + Math.random() * 808,
        width: 64,
        height: 64,
        type: hazardTypes[Math.floor(Math.random() * hazardTypes.length)],
      });
    }

    if (Math.random() > 0.62) {
      boosts.push({
        id: `practice-${y}`,
        x: 80 + Math.random() * 840,
        y: y + 20 + Math.random() * 50,
        collected: false,
      });
    }
  }

  return { obstacles, boosts };
}

function startPractice() {
  practiceMode = true;
  myPlayerId = 0;

  const course = createPracticeCourse();

  gameState = {
    status: 'racing',
    players: [{
      id: 0,
      x: 500,
      y: 90,
      speedX: 0,
      boostMs: 0,
      stunMs: 0,
      finished: false,
      finishTime: 0,
    }],
    obstacles: course.obstacles,
    boosts: course.boosts,
  };

  $('#countdown').textContent = 'PRACTICE!';
  showScreen('game');

  setTimeout(() => {
    $('#countdown').textContent = '';
  }, 900);

  animationActive = true;
  practiceLastFrame = performance.now();
  requestAnimationFrame(renderLoop);
}

function practiceOverlap(player, obstacle) {
  const radius = 20;

  return (
    player.x + radius > obstacle.x &&
    player.x - radius < obstacle.x + obstacle.width &&
    player.y + radius > obstacle.y - obstacle.height / 2 &&
    player.y - radius < obstacle.y + obstacle.height / 2
  );
}

function updatePractice(deltaTime) {
  const player = gameState.players[0];

  if (!player || player.finished) return;

  if (player.stunMs > 0) {
    player.stunMs -= deltaTime;
    return;
  }

  const direction = (input.left ? -1 : 0) + (input.right ? 1 : 0);

  player.speedX += (direction * 4.8 - player.speedX) * 0.17;
  player.x = Math.max(30, Math.min(970, player.x + player.speedX * deltaTime * 0.08));
  player.y += (player.boostMs > 0 ? 0.23 : 0.135) * deltaTime;
  player.boostMs -= deltaTime;

  if (gameState.obstacles.some((obstacle) => practiceOverlap(player, obstacle))) {
    player.stunMs = 950;
    player.y = Math.max(0, player.y - 65);
    player.boostMs = 0;
  }

  gameState.boosts.forEach((boost) => {
    if (!boost.collected && Math.hypot(player.x - boost.x, player.y - boost.y) < 31) {
      boost.collected = true;
      player.boostMs = 1700;
    }
  });

  if (player.y >= COURSE_HEIGHT - 100) {
    player.finished = true;
    animationActive = false;

    $('#winner').textContent = 'Practice Complete!';
    $('#rankings').innerHTML = `
      <div class="rank">
        <span>🏆 Your time</span>
        <span>Great dive!</span>
      </div>
    `;

    setTimeout(() => showScreen('results'), 650);
  }
}

function zoneAt(worldY) {
  if (worldY < 1100) return 'SHALLOW REEF';
  if (worldY < 2300) return 'KELP FOREST';
  if (worldY < 3600) return 'DEEP CAVERNS';
  return 'ABYSS FINISH';
}

function drawBackground(cameraY) {
  const depth = Math.min(0.8, cameraY / COURSE_HEIGHT);

  ctx.fillStyle = `hsl(${202 - depth * 25} ${75 - depth * 20}% ${48 - depth * 30}%)`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (let i = 0; i < 50; i += 1) {
    circle(
      (i * 117) % WIDTH,
      (i * 179 - cameraY * 0.35) % HEIGHT,
      1 + (i % 3),
      `#d2ffff${30 + (i % 4) * 15}`
    );
  }

  if (cameraY < 1100) {
    for (let x = 0; x < WIDTH; x += 68) {
      const offset = (x % 3) * 8;
      ctx.fillStyle = '#168b83';
      ctx.fillRect(x, HEIGHT - 70 + offset, 36, 70);
      circle(x + 17, HEIGHT - 70 + offset, 28, '#24aa9a');
    }
  }

  if (cameraY > 1000 && cameraY < 2700) {
    ctx.strokeStyle = '#2cc28a';
    ctx.lineWidth = 13;

    for (let x = 30; x < WIDTH; x += 90) {
      ctx.beginPath();
      ctx.moveTo(x, HEIGHT);
      ctx.quadraticCurveTo(
        x + 20,
        HEIGHT - 160,
        x + Math.sin(cameraY / 180 + x) * 26,
        HEIGHT - 300
      );
      ctx.stroke();
    }
  }

  if (cameraY > 2100) {
    for (let x = 20; x < WIDTH; x += 100) {
      circle(x, HEIGHT - 35, 27, '#14476a');
      circle(x + 17, HEIGHT - 50, 10, '#35e0c8');
    }
  }
}

function drawObstacle(obstacle, cameraY) {
  const y = obstacle.y - cameraY;

  if (y < -70 || y > HEIGHT + 70) return;

  const sprite = images[`hazard-${obstacle.type}`];

  if (spriteReady(sprite)) {
    ctx.drawImage(sprite, obstacle.x, y - 32, 64, 64);
  } else {
    circle(obstacle.x + 32, y, 25, '#8e3f8f');
  }
}

function drawBoost(bubble, cameraY) {
  if (bubble.collected) return;

  const y = bubble.y - cameraY;
  if (y < -50 || y > HEIGHT + 50) return;

  if (spriteReady(images['boost-bubble'])) {
    ctx.drawImage(images['boost-bubble'], bubble.x - 24, y - 24, 48, 48);
  } else {
    circle(bubble.x, y, 16, '#aaf8ff');
  }
}

function drawFish(player, cameraY) {
  if (player.finished) return;

  const y = player.y - cameraY;

  ctx.save();
  ctx.translate(player.x, y);
  ctx.rotate(Math.PI / 2 + player.speedX * 0.018);

  ctx.shadowColor = FISH_COLORS[player.id];
  ctx.shadowBlur = player.boostMs > 0 ? 25 : 7;

  if (spriteReady(images.east)) {
    ctx.drawImage(images.east, -29, -29, 58, 58);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = FISH_COLORS[player.id];
    ctx.fillRect(-30, -30, 60, 60);
  } else {
    circle(0, 0, 20, FISH_COLORS[player.id]);
  }

  ctx.restore();

  ctx.font = 'bold 14px Nunito';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'white';

  ctx.fillText(
    `P${player.id + 1}${player.id === myPlayerId ? ' · YOU' : ''}`,
    player.x,
    y - 40
  );

  if (player.stunMs > 0) {
    ctx.font = '22px Arial';
    ctx.fillText('✦', player.x, y - 56);
  }
}

function drawFinishGate(cameraY) {
  const y = COURSE_HEIGHT - 90 - cameraY;

  if (y < -100 || y > HEIGHT + 100) return;

  const flag = images['finish_line'];

  if (spriteReady(flag)) {
    // Scale to a fixed width, preserving aspect ratio
    const w = 280;
    const h = w * (flag.naturalHeight / flag.naturalWidth);
    ctx.drawImage(flag, WIDTH / 2 - w / 2, y - h / 2, w, h);
  } else {
    // Fallback: original placeholder
    ctx.save();
    ctx.translate(WIDTH / 2, y);
    ctx.shadowColor = '#fff176';
    ctx.shadowBlur = 25;
    ctx.fillStyle = '#ffdc52';
    ctx.fillRect(-130, -9, 260, 18);
    ctx.restore();
  }

  ctx.save();
  ctx.font = 'bold 16px Nunito';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText('FINISH GATE', WIDTH / 2, y - 40);
  ctx.restore();
}

function renderLoop() {
  if (!animationActive) return;

  if (practiceMode) {
    const now = performance.now();
    updatePractice(Math.min(32, now - practiceLastFrame));
    practiceLastFrame = now;
  }

  const leadY = Math.max(90, ...gameState.players.map((player) => player.y));
  const cameraY = Math.max(
    0,
    Math.min(COURSE_HEIGHT - HEIGHT, leadY - HEIGHT * 0.58)
  );

  $('#zone').textContent = zoneAt(cameraY + HEIGHT / 2);

  $('#progress').style.setProperty(
    '--p',
    `${Math.min(100, (leadY / (COURSE_HEIGHT - 100)) * 100)}%`
  );

  $('#raceInfo').textContent =
    `${gameState.players.filter((player) => player.finished).length}/${gameState.players.length} finished`;

  drawBackground(cameraY);
  gameState.obstacles.forEach((obstacle) => drawObstacle(obstacle, cameraY));
  gameState.boosts.forEach((bubble) => drawBoost(bubble, cameraY));
  drawFinishGate(cameraY);
  gameState.players.forEach((player) => drawFish(player, cameraY));

  requestAnimationFrame(renderLoop);
}

function setInput(key, isDown) {
  let changed = false;

  if (key === 'a' || key === 'arrowleft') {
    changed = input.left !== isDown;
    input.left = isDown;
  }

  if (key === 'd' || key === 'arrowright') {
    changed = input.right !== isDown;
    input.right = isDown;
  }

  if (changed && !practiceMode) {
    sendInput();
  }
}

addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  setInput(key, true);

  if (key.startsWith('arrow')) {
    event.preventDefault();
  }
});

addEventListener('keyup', (event) => {
  setInput(event.key.toLowerCase(), false);
});

$('#practiceMode').onclick = startPractice;
$('#createRoom').onclick = () => socket.emit('create-room');
$('#joinRoom').onclick = () => socket.emit('join-room', {
  code: $('#roomCode').value,
});
$('#startRace').onclick = () => socket.emit('start-race');
$('#howBtn').onclick = () => showScreen('how');
$('.back').onclick = () => showScreen('menu');
$('#home').onclick = () => location.reload();