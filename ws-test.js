const WebSocket = require('ws');

const ws = new WebSocket('wss://web.whatsapp.com/ws/chat');

ws.on('open', () => {
  console.log('✅ WebSocket ke WhatsApp berhasil!');
  ws.close();
});

ws.on('error', (err) => {
  console.error('❌ Gagal konek ke WhatsApp Web:', err.message);
});
