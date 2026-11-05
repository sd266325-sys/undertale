/**
 * 멀티 언더테일 - WebSocket 서버
 * Render / Railway / 로컬에서 실행 가능
 *
 * 설치: npm install
 * 실행: npm start
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// roomCode -> { clients: Map<ws, playerInfo>, hostId, started }
const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function broadcast(room, data, except = null) {
  if (!room) return;
  const msg = JSON.stringify(data);
  for (const [ws] of room.clients) {
    if (ws !== except && ws.readyState === 1) {
      try { ws.send(msg); } catch (e) {}
    }
  }
}

function getRoomState(room) {
  const players = [];
  for (const [, info] of room.clients) {
    players.push({
      id: info.id,
      role: info.role,
      col: info.col,
      name: info.name,
      x: info.x,
      y: info.y,
      hp: info.hp,
      dead: info.dead
    });
  }
  return {
    code: room.code,
    started: room.started,
    hostId: room.hostId,
    players
  };
}

// Static file server + WebSocket
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath.replace(/\.\./g, ''));

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let nextId = 1;

wss.on('connection', (ws) => {
  const playerId = 'p' + (nextId++);
  let currentRoom = null;
  let info = {
    id: playerId,
    role: '',
    col: '#f00',
    name: 'Player',
    x: 320,
    y: 295,
    hp: 20,
    dead: false
  };

  ws.send(JSON.stringify({ type: 'welcome', id: playerId }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    switch (msg.type) {
      case 'create': {
        // 방 생성
        let code = genCode();
        // 혹시 겹치면 재시도
        let tries = 0;
        while (rooms.has(code) && tries++ < 10) code = genCode();

        const room = {
          code,
          clients: new Map(),
          hostId: playerId,
          started: false
        };
        info.role = 'host';
        info.col = '#f00';
        info.name = msg.name || 'P1';
        room.clients.set(ws, info);
        rooms.set(code, room);
        currentRoom = room;

        ws.send(JSON.stringify({
          type: 'created',
          code,
          id: playerId,
          role: 'host',
          state: getRoomState(room)
        }));
        break;
      }

      case 'join': {
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '방을 찾을 수 없습니다: ' + code }));
          return;
        }
        if (room.clients.size >= 2) {
          ws.send(JSON.stringify({ type: 'error', message: '방이 가득 찼습니다 (최대 2명)' }));
          return;
        }
        if (room.started) {
          ws.send(JSON.stringify({ type: 'error', message: '이미 게임이 시작되었습니다' }));
          return;
        }

        info.role = 'guest';
        info.col = '#4cf';
        info.name = msg.name || 'P2';
        room.clients.set(ws, info);
        currentRoom = room;

        ws.send(JSON.stringify({
          type: 'joined',
          code,
          id: playerId,
          role: 'guest',
          state: getRoomState(room)
        }));

        // 방 전체에 입장 알림
        broadcast(room, {
          type: 'player_join',
          id: playerId,
          role: 'guest',
          col: info.col,
          name: info.name,
          state: getRoomState(room)
        });
        break;
      }

      case 'start': {
        // 방장만 시작 가능
        if (!currentRoom || currentRoom.hostId !== playerId) return;
        currentRoom.started = true;
        broadcast(currentRoom, {
          type: 'start',
          seed: msg.seed || ((Math.random() * 1e9) | 0),
          state: getRoomState(currentRoom)
        });
        break;
      }

      case 'pos': {
        // 위치/상태 업데이트 → 같은 방 전체에 릴레이
        if (!currentRoom) return;
        info.x = msg.x ?? info.x;
        info.y = msg.y ?? info.y;
        info.hp = msg.hp ?? info.hp;
        info.dead = !!msg.dead;
        currentRoom.clients.set(ws, info);

        broadcast(currentRoom, {
          type: 'pos',
          id: playerId,
          x: info.x,
          y: info.y,
          hp: info.hp,
          dead: info.dead,
          col: info.col,
          role: info.role
        }, ws); // 본인 제외하고 전송
        break;
      }

      case 'game': {
        // 게임 상태 동기화 (패턴 인덱스, 스토리 등) - 방장 권한
        if (!currentRoom || currentRoom.hostId !== playerId) return;
        broadcast(currentRoom, {
          type: 'game',
          ...msg,
          id: playerId
        }, ws);
        break;
      }

      case 'chat': {
        if (!currentRoom) return;
        broadcast(currentRoom, {
          type: 'chat',
          id: playerId,
          name: info.name,
          text: String(msg.text || '').slice(0, 100)
        });
        break;
      }

      case 'leave': {
        cleanup();
        break;
      }
    }
  });

  function cleanup() {
    if (currentRoom) {
      currentRoom.clients.delete(ws);
      broadcast(currentRoom, {
        type: 'player_leave',
        id: playerId,
        state: getRoomState(currentRoom)
      });
      if (currentRoom.clients.size === 0) {
        rooms.delete(currentRoom.code);
      } else if (currentRoom.hostId === playerId) {
        // 방장이 나가면 방 해체
        broadcast(currentRoom, { type: 'error', message: '방장이 나갔습니다' });
        for (const [other] of currentRoom.clients) {
          try { other.close(); } catch (e) {}
        }
        rooms.delete(currentRoom.code);
      }
      currentRoom = null;
    }
  }

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// 오래된 빈 방 정리
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.clients.size === 0) rooms.delete(code);
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`멀티 언더테일 서버 실행 중: http://localhost:${PORT}`);
  console.log(`WebSocket 준비됨`);
});
