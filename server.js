// ================================================================
//  WhatsApp Online Monitor — Backend Server
//  Host on Railway.app — monitors WhatsApp presence
//  and sends Firebase push notifications to your Android app
// ================================================================

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const admin = require('firebase-admin');
const express = require('express');
const fs = require('fs');

// ── Firebase ──────────────────────────────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT env variable is missing or invalid.');
  console.error('   Railway → your service → Variables → add FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
console.log('✅ Firebase Admin initialized');

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ── Contact Storage ───────────────────────────────────────────────────────────
let contacts = {};
const CONTACTS_FILE = '/app/contacts.json';

function loadContacts() {
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
      console.log(`📂 Loaded ${Object.keys(contacts).length} saved contact(s)`);
    }
  } catch { contacts = {}; }
}

function saveContacts() {
  try { fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2)); }
  catch (e) { console.warn('Could not save contacts:', e.message); }
}

loadContacts();

// ── WhatsApp State ────────────────────────────────────────────────────────────
let isReady = false;
let qrDataURL = null;
const onlineStatus = {};

// ── WhatsApp Client ───────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--single-process', '--no-zygote'],
  },
});

client.on('qr', async (qr) => {
  qrcodeTerminal.generate(qr, { small: true });
  qrDataURL = await qrcode.toDataURL(qr);
  isReady = false;
  console.log('📱 QR ready — open your Railway URL + /qr in a browser to scan');
});

client.on('authenticated', () => console.log('🔐 WhatsApp authenticated'));

client.on('ready', () => {
  isReady = true;
  qrDataURL = null;
  console.log('✅ WhatsApp connected and ready!');
  subscribeAll();
});

client.on('disconnected', (reason) => {
  isReady = false;
  console.log('❌ WhatsApp disconnected:', reason);
  setTimeout(() => { console.log('🔄 Reconnecting...'); client.initialize(); }, 10000);
});

// ── Subscribe to presence updates ─────────────────────────────────────────────
async function subscribeAll() {
  for (const phone of Object.keys(contacts)) await subscribeToContact(phone);
}

async function subscribeToContact(phone) {
  try {
    const contactId = `${phone}@c.us`;
    const contact = await client.getContactById(contactId);
    const chat = await contact.getChat();
    await chat.subscribeToPresenceUpdates();
    chat.removeAllListeners('presence_update');
    chat.on('presence_update', async (presence) => {
      const nowOnline = presence.type === 'available';
      const wasOnline = onlineStatus[contactId];
      if (nowOnline && !wasOnline) {
        const name = contacts[phone]?.name || phone;
        console.log(`🟢 ${name} is now ONLINE`);
        if (contacts[phone]?.fcmToken) await sendPush(contacts[phone].fcmToken, name, phone);
      }
      onlineStatus[contactId] = nowOnline;
    });
    console.log(`👁  Watching: ${contacts[phone]?.name || phone}`);
  } catch (err) {
    console.warn(`⚠️  Could not watch ${phone}: ${err.message}`);
  }
}

// ── Firebase Push Notification ────────────────────────────────────────────────
async function sendPush(fcmToken, name, phone) {
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: '🟢 WhatsApp Online Alert', body: `${name} is now online!` },
      data: { phone: String(phone), name: String(name), timestamp: String(Date.now()) },
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'whatsapp_alerts', color: '#25D366', priority: 'high' },
      },
    });
    console.log(`📲 Notification sent → ${name}`);
  } catch (err) {
    console.error(`❌ Notification failed for ${name}: ${err.message}`);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/qr', (req, res) => {
  if (isReady) return res.send(`<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px;background:#f0f2f5">
    <div style="background:#fff;border-radius:16px;padding:40px;max-width:400px;margin:auto;box-shadow:0 2px 20px rgba(0,0,0,0.1)">
      <div style="font-size:56px">✅</div><h2 style="color:#128C7E">WhatsApp Connected!</h2>
      <p style="color:#666">Server is online and monitoring contacts.</p>
      <a href="/health" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Check Status</a>
    </div></body></html>`);

  if (!qrDataURL) return res.send(`<!DOCTYPE html><html>
    <head><meta http-equiv="refresh" content="3"></head>
    <body style="font-family:Arial;text-align:center;padding:60px;background:#f0f2f5">
      <div style="background:#fff;border-radius:16px;padding:40px;max-width:400px;margin:auto;box-shadow:0 2px 20px rgba(0,0,0,0.1)">
        <div style="font-size:48px">⏳</div><h2 style="color:#075E54">Generating QR Code...</h2>
        <p style="color:#888">Page refreshes every 3 seconds. Please wait up to 60 seconds.</p>
      </div></body></html>`);

  res.send(`<!DOCTYPE html><html>
    <head><meta http-equiv="refresh" content="25"></head>
    <body style="font-family:Arial;text-align:center;padding:40px;background:#f0f2f5">
      <div style="background:#fff;border-radius:16px;padding:40px;max-width:460px;margin:auto;box-shadow:0 2px 20px rgba(0,0,0,0.1)">
        <div style="font-size:48px">📱</div>
        <h2 style="color:#075E54">Scan with WhatsApp</h2>
        <p style="color:#555">Open WhatsApp → tap <b>⋮</b> → <b>Linked Devices</b> → <b>Link a Device</b></p>
        <img src="${qrDataURL}" style="width:260px;height:260px;border:6px solid #f0f2f5;border-radius:12px"/>
        <p style="color:#aaa;font-size:12px;margin-top:16px">QR expires ~60s. Page auto-refreshes every 25s.</p>
      </div></body></html>`);
});

app.get('/health', (req, res) => res.json({
  status: 'ok', whatsappReady: isReady,
  contactsMonitored: Object.keys(contacts).length,
  uptimeSeconds: Math.floor(process.uptime()),
}));

app.post('/contacts', async (req, res) => {
  const { phone, name, fcmToken } = req.body;
  if (!phone || !fcmToken) return res.status(400).json({ error: 'phone and fcmToken required' });
  const p = String(phone).replace(/\D/g, '');
  contacts[p] = { name: name?.trim() || p, fcmToken };
  saveContacts();
  if (isReady) await subscribeToContact(p);
  res.json({ success: true, message: `Now monitoring ${contacts[p].name}` });
});

app.get('/contacts', (req, res) => res.json({ contacts }));

app.delete('/contacts/:phone', (req, res) => {
  const { phone } = req.params;
  if (!contacts[phone]) return res.status(404).json({ error: 'Not found' });
  const name = contacts[phone].name;
  delete contacts[phone]; delete onlineStatus[`${phone}@c.us`];
  saveContacts();
  res.json({ success: true, message: `Stopped monitoring ${name}` });
});

app.put('/contacts/:phone/token', (req, res) => {
  const { phone } = req.params;
  if (!contacts[phone]) return res.status(404).json({ error: 'Not found' });
  contacts[phone].fcmToken = req.body.fcmToken;
  saveContacts();
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
client.initialize();
console.log('🔄 Starting WhatsApp client...');
