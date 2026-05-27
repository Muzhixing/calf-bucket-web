<template>
  <div class="viewer-root">
    <header class="viewer-header">
      <div>
        <h1>WebRTC 观看端</h1>
        <p>接收板卡原始视频，在浏览器叠加识别框</p>
      </div>
      <router-link class="back-link" to="/">返回编辑器</router-link>
    </header>

    <section class="panel controls">
      <label>信令 WebSocket<input v-model="signalUrl" /></label>
      <label>设备 ID<input v-model="deviceId" /></label>
      <label>ICE Servers<input v-model="iceServersInput" placeholder="stun:stun.l.google.com:19302" /></label>
      <button class="primary" :disabled="isConnecting || isConnected" @click="connect">
        {{ isConnecting ? '连接中...' : '连接' }}
      </button>
      <button :disabled="!isConnected && !isConnecting" @click="disconnect">断开</button>
      <button @click="refreshStatus">状态</button>
      <span :class="['dot', statusClass]"></span>
      <span>{{ statusText }}</span>
    </section>

    <section class="stage">
      <video ref="videoRef" autoplay playsinline muted @loadedmetadata="drawOverlay"></video>
      <canvas ref="overlayRef"></canvas>
      <div class="hint" v-if="!isConnected">等待浏览器连接信令和板卡 offer</div>
    </section>

    <section class="info-grid">
      <div class="panel">
        <h2>检测元数据</h2>
        <pre>{{ JSON.stringify(metadata || {}, null, 2) }}</pre>
      </div>
      <div class="panel">
        <h2>设备状态</h2>
        <pre>{{ statusPayload }}</pre>
      </div>
      <div class="panel logs">
        <div class="log-header">
          <h2>日志</h2>
          <button @click="logs = []">清空</button>
        </div>
        <div class="log-list">
          <div v-for="(item, idx) in logs" :key="idx">{{ item }}</div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onUnmounted, computed, watch } from 'vue'

const defaultSignalUrl = () => {
  const base = import.meta.env.VITE_SIGNAL_URL || 'ws://120.48.24.192:5173/ws/browser'
  return base
}

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://120.48.24.192:5173'
const signalUrl = ref(defaultSignalUrl())
const deviceId = ref('robot001')
const iceServersInput = ref('')
const isConnected = ref(false)
const isConnecting = ref(false)
const logs = ref([])
const metadata = ref(null)
const statusPayload = ref('{}')
const videoRef = ref(null)
const overlayRef = ref(null)

let ws = null
let pc = null

const statusText = computed(() => {
  if (isConnecting.value) return '连接中'
  return isConnected.value ? '已连接' : '未连接'
})

const statusClass = computed(() => {
  if (isConnecting.value) return 'pending'
  return isConnected.value ? 'ok' : 'idle'
})

function log(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logs.value.unshift(`${time} ${msg}`)
  if (logs.value.length > 160) logs.value.length = 160
}

function parseIceServers() {
  const urls = iceServersInput.value.split(',').map(s => s.trim()).filter(Boolean)
  return urls.length ? [{ urls }] : undefined
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ from: 'browser', to: 'python', ...payload }))
  }
}

function ensurePeer() {
  if (pc) return pc
  pc = new RTCPeerConnection({ iceServers: parseIceServers() })
  pc.ontrack = (event) => {
    const [stream] = event.streams
    if (videoRef.value && stream) videoRef.value.srcObject = stream
  }
  pc.onicecandidate = (event) => {
    if (!event.candidate) return
    send({
      type: 'candidate',
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex
    })
  }
  pc.onconnectionstatechange = () => {
    log(`Peer ${pc.connectionState}`)
    isConnected.value = pc.connectionState === 'connected' || Boolean(ws)
  }
  pc.ondatachannel = (event) => {
    event.channel.onmessage = (dataEvent) => {
      try {
        metadata.value = JSON.parse(String(dataEvent.data))
      } catch {
        log('metadata 解析失败')
      }
    }
    log(`DataChannel ${event.channel.label}`)
  }
  return pc
}

async function handleSignal(raw) {
  const msg = JSON.parse(raw)
  if (msg.type === 'offer' && msg.sdp) {
    const peer = ensurePeer()
    await peer.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    send({ type: 'answer', sdp: peer.localDescription.sdp })
    log('收到 offer 并回复 answer')
  } else if (msg.type === 'candidate' && msg.candidate) {
    await pc?.addIceCandidate({
      candidate: msg.candidate,
      sdpMid: msg.sdpMid,
      sdpMLineIndex: msg.sdpMLineIndex
    })
  } else if (msg.type === 'ping') {
    send({ type: 'pong' })
  }
}

async function connect() {
  await disconnect()
  isConnecting.value = true
  ws = new WebSocket(signalUrl.value)
  ws.onopen = () => {
    isConnecting.value = false
    isConnected.value = true
    log(`信令已连接: ${signalUrl.value}`)
  }
  ws.onmessage = (event) => handleSignal(String(event.data)).catch(err => log(String(err)))
  ws.onclose = () => {
    isConnecting.value = false
    isConnected.value = false
    log('信令连接已关闭')
  }
  ws.onerror = () => {
    isConnecting.value = false
    log('信令连接错误')
  }
}

async function disconnect() {
  if (pc) {
    pc.getSenders().forEach(sender => sender.track && sender.track.stop())
    pc.close()
    pc = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
  if (videoRef.value) videoRef.value.srcObject = null
  isConnected.value = false
  isConnecting.value = false
}

async function refreshStatus() {
  try {
    const url = `${apiBase.replace(/\/$/, '')}/api/webget?deviceID=${encodeURIComponent(deviceId.value)}`
    const response = await fetch(url)
    statusPayload.value = JSON.stringify(await response.json(), null, 2)
  } catch (error) {
    statusPayload.value = String(error)
  }
}

function drawOverlay() {
  const video = videoRef.value
  const canvas = overlayRef.value
  const ctx = canvas?.getContext('2d')
  if (!video || !canvas || !ctx) return
  const width = video.videoWidth || metadata.value?.image?.width || 1280
  const height = video.videoHeight || metadata.value?.image?.height || 720
  canvas.width = width
  canvas.height = height
  ctx.clearRect(0, 0, width, height)
  ;(metadata.value?.detections || []).forEach((item) => {
    const bbox = item.bbox
    if (!bbox) return
    const w = bbox.right - bbox.left
    const h = bbox.bottom - bbox.top
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 3
    ctx.strokeRect(bbox.left, bbox.top, w, h)
    ctx.fillStyle = 'rgba(8, 47, 73, 0.85)'
    ctx.fillRect(bbox.left, Math.max(0, bbox.top - 24), Math.max(120, w), 24)
    ctx.fillStyle = '#e0f2fe'
    ctx.font = '16px sans-serif'
    const score = item.score == null ? '' : ` ${(item.score * 100).toFixed(0)}%`
    ctx.fillText(`${item.label || 'bucket'}${score}`, bbox.left + 6, Math.max(18, bbox.top - 6))
  })
}

watch(metadata, drawOverlay)
onUnmounted(() => disconnect())
</script>

<style scoped>
.viewer-root {
  min-height: 100vh;
  background: #0f172a;
  color: #f8fafc;
  padding: 20px;
  display: grid;
  gap: 16px;
}

.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.viewer-header h1 { margin: 0; font-size: 26px; }
.viewer-header p { margin: 6px 0 0; color: #94a3b8; }
.back-link { color: #67e8f9; text-decoration: none; font-weight: 600; }

.panel {
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(15,23,42,0.86);
  border-radius: 8px;
  padding: 14px;
}

.controls {
  display: grid;
  grid-template-columns: minmax(260px, 2fr) 160px minmax(220px, 1fr) repeat(3, auto) auto 80px;
  gap: 10px;
  align-items: end;
}

label { display: grid; gap: 6px; color: #94a3b8; font-size: 12px; }
input {
  background: #020617;
  border: 1px solid rgba(255,255,255,0.16);
  color: #fff;
  border-radius: 6px;
  padding: 8px 10px;
}

button {
  border: 0;
  border-radius: 6px;
  background: #334155;
  color: white;
  padding: 9px 14px;
  cursor: pointer;
}
button.primary { background: #06b6d4; color: #082f49; font-weight: 700; }
button:disabled { opacity: 0.45; cursor: not-allowed; }

.dot { width: 10px; height: 10px; border-radius: 999px; background: #64748b; display: inline-block; }
.dot.pending { background: #facc15; }
.dot.ok { background: #22c55e; }

.stage {
  position: relative;
  min-height: 58vh;
  background: #000;
  overflow: hidden;
  border-radius: 8px;
}

video,
canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #94a3b8;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}

h2 { margin: 0 0 10px; font-size: 15px; }
pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  color: #cbd5e1;
  font-size: 12px;
}
.log-header { display: flex; justify-content: space-between; align-items: center; }
.log-list { max-height: 220px; overflow: auto; color: #cbd5e1; font-size: 12px; }

@media (max-width: 900px) {
  .controls,
  .info-grid { grid-template-columns: 1fr; }
}
</style>
