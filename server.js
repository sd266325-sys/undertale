const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 정적 파일 서빙 (HTML, 이미지 등)
app.use(express.static(path.join(__dirname)));

// 루트 경로 → index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 헬스체크 (Render용)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Toriel Boss Rush server running on port ${PORT}`);
});
