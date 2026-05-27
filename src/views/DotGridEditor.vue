<template>
  <div class="grid-container">
    <canvas 
      ref="canvasRef"
      class="grid-canvas"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
      @dblclick="handleDoubleClick"
    ></canvas>

    <div class="sidebar" :class="{ 'sidebar-hidden': !isSidebarVisible }">
      <div class="sidebar-toggle" @click="isSidebarVisible = !isSidebarVisible" title="切换列表显示">
        <span class="toggle-icon">{{ isSidebarVisible ? '→' : '←' }}</span>
        <span class="toggle-text">{{ isSidebarVisible ? '收起' : '记录' }}</span>
      </div>

      <div class="sidebar-header" :style="{ borderLeft: `4px solid ${currentRoute.color}` }">
        <span>路线 {{ currentRoute.id }} 记录 ({{ currentRoute.logs.length }})</span>
      </div>
      
      <div class="sidebar-content">
        <ul class="log-list">
          <li v-for="(log, index) in currentRoute.logs" :key="index" class="log-item" :style="{ color: currentRoute.color }">
            <span class="index">{{ index + 1 }}.</span>
            {{ log }}
          </li>
          <li v-if="currentRoute.logs.length === 0" class="empty-tip">
            当前路线暂无记录<br>
            <span style="font-size:10px; opacity:0.6">双击点进行连线</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="bottom-panel">
      <router-link class="viewer-link" to="/viewer">WebRTC 观看端</router-link>
      <div class="api-panel">
        <label>服务<input v-model="apiBase" class="api-input wide" placeholder="http://120.48.24.192:5173" /></label>
        <label>设备<input v-model="deviceID" class="api-input" /></label>
        <label>米/格<input v-model.number="gridScaleM" class="api-input short" type="number" step="0.1" /></label>
        <label>投喂<input v-model.number="feedAmount" class="api-input short" type="number" /></label>
        <button class="submit-btn" @click="submitCurrentRoute">下发路线</button>
        <button @click="refreshDeviceStatus">状态</button>
        <span class="api-message">{{ apiMessage }}</span>
      </div>
      <button class="mode-btn" @click="toggleMode">
        {{ currentMode === 'edit' ? '当前：编辑' : '当前：执行' }}
      </button>

      <div v-if="currentMode === 'edit'" class="panel-content edit-mode">
        
        <div class="group route-manager">
          <span class="label">路线:</span>
          <select v-if="routes.length > 0" class="route-select" :value="activeRouteIdx" @change="switchRoute">
            <option v-for="(r, idx) in routes" :key="r.id" :value="idx">
              #{{ r.id }} ({{ r.connections.length }})
            </option>
          </select>
          <button class="icon-btn add-btn" @click="addNewRoute" title="新建路线">+</button>
        </div>

        <div class="divider"></div>

        <div class="group">
          <button @click="clearCurrentRoute" class="danger-btn">清空当前</button>
          <button @click="undo" :disabled="historyStack.length === 0">撤销</button>
        </div>

        <div class="divider"></div>

        <div class="group user-config-area">
          <span class="label">起点:</span>
          <div class="input-wrapper">
            <span>R:</span><input type="number" placeholder="0000000" class="long-input" />
          </div>
          <div class="input-wrapper">
            <span>C:</span><input type="number" placeholder="0000000" class="long-input" />
          </div>
          <button class="save-btn">保存</button>
        </div>

        <div class="divider"></div>

        <div class="group">
          <button @click="exportData">导出</button>
          <button @click="triggerImport">读取</button>
          <input type="file" ref="fileInput" style="display: none" @change="importData" accept=".json"/>
        </div>
      </div>

      <div v-else class="panel-content run-mode">
        <button class="start-run-btn" @click="startAnimation">
          <span class="icon">▶</span> 执行所有路线
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue';

// ==========================================
// 1. 配置常量
// ==========================================
const GRID_GAP = 40;     
const POINT_RADIUS = 5;  
const HIT_RADIUS = 20;   // 【修改】增大点击范围 (原15 -> 20)，极大提升点击成功率
const BG_COLOR = '#1e1e1e';
const POINT_COLOR = '#555'; 
const SELECTED_COLOR = '#ffffff'; 
const PARTICLE_SPEED = 0.015; 

const ROUTE_COLORS = [
  '#00ffcc', '#ff3366', '#ffff00', '#3399ff', 
  '#cc66ff', '#ff9933', '#99ff33'
];

// ==========================================
// 2. 状态管理
// ==========================================
const canvasRef = ref(null);
const fileInput = ref(null);
const isSidebarVisible = ref(true);
const currentMode = ref('edit'); 

const view = reactive({
  offsetX: 0, offsetY: 0,
  isDragging: false,
  lastMouseX: 0, lastMouseY: 0
});

const routes = ref([]); 
const activeRouteIdx = ref(0);
const points = ref({}); 
const historyStack = ref([]); 
const apiBase = ref(import.meta.env.VITE_API_BASE_URL || (window.location.hostname === '120.48.24.192' ? window.location.origin : 'http://120.48.24.192:5173'));
const deviceID = ref('robot001');
const gridScaleM = ref(0.5);
const feedAmount = ref(500);
const apiMessage = ref('等待下发路径');

let animationFrameId = null;
const particles = ref([]); 

// 安全获取当前路线
const currentRoute = computed(() => {
  const route = routes.value[activeRouteIdx.value];
  if (!route) {
    return { id: '-', color: '#666', logs: [], connections: [] };
  }
  return route;
});

// ==========================================
// 3. 初始化与生命周期
// ==========================================

onMounted(() => {
  addNewRoute(); 
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  renderLoop();
});

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas);
  cancelAnimationFrame(animationFrameId);
});

function resizeCanvas() {
  const canvas = canvasRef.value;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
  }
}

function renderLoop() {
  draw();
  updateParticles();
  animationFrameId = requestAnimationFrame(renderLoop);
}

// ==========================================
// 4. 绘图逻辑
// ==========================================
function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const centerX = w / 2 + view.offsetX;
  const centerY = h / 2 + view.offsetY;

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  const startCol = Math.floor((-view.offsetX - w/2) / GRID_GAP) - 1;
  const endCol = Math.ceil((-view.offsetX + w/2) / GRID_GAP) + 1;
  const startRow = Math.floor((-view.offsetY - h/2) / GRID_GAP) - 1;
  const endRow = Math.ceil((-view.offsetY + h/2) / GRID_GAP) + 1;

  ctx.fillStyle = POINT_COLOR;
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const key = `${r},${c}`;
      if (!points.value[key]) {
        const x = centerX + c * GRID_GAP;
        const y = centerY + r * GRID_GAP;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  routes.value.forEach(route => {
    route.connections.forEach((conn, index) => {
      drawArrow(ctx, conn.from, conn.to, centerX, centerY, route.color, index === 0, route.id);
    });
  });

  for (const key in points.value) {
    const p = points.value[key];
    const x = centerX + p.c * GRID_GAP;
    const y = centerY + p.r * GRID_GAP;
    
    const glow = ctx.createRadialGradient(x, y, POINT_RADIUS, x, y, POINT_RADIUS * 4);
    glow.addColorStop(0, SELECTED_COLOR); 
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, POINT_RADIUS * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, POINT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  particles.value.forEach(p => {
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function drawArrow(ctx, fromKey, toKey, centerX, centerY, color, showLabel, routeId) {
  const [r1, c1] = fromKey.split(',').map(Number);
  const [r2, c2] = toKey.split(',').map(Number);

  let x1 = centerX + c1 * GRID_GAP;
  let y1 = centerY + r1 * GRID_GAP;
  let x2 = centerX + c2 * GRID_GAP;
  let y2 = centerY + r2 * GRID_GAP;

  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const headlen = 10;
  const dist = POINT_RADIUS + 5; 
  const endX = x2 - Math.cos(angle) * dist;
  const endY = y2 - Math.sin(angle) * dist;

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
  ctx.fillStyle = color;
  ctx.fill();

  if (showLabel) {
    ctx.fillStyle = color;
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`R${routeId}`, x1 + 8, y1 - 8);
  }
}

// ==========================================
// 5. 交互逻辑
// ==========================================

let lastClickedPoint = null; 

function handleMouseDown(e) {
  view.isDragging = true;
  view.lastMouseX = e.clientX;
  view.lastMouseY = e.clientY;
}

function handleMouseMove(e) {
  if (view.isDragging) {
    const dx = e.clientX - view.lastMouseX;
    const dy = e.clientY - view.lastMouseY;
    view.offsetX += dx;
    view.offsetY += dy;
    view.lastMouseX = e.clientX;
    view.lastMouseY = e.clientY;
  }
}

function handleMouseUp(e) {
  if (view.isDragging) checkClickHit(e.clientX, e.clientY);
  view.isDragging = false;
}

function handleDoubleClick(e) {
  checkClickHit(e.clientX, e.clientY);
}

function checkClickHit(mouseX, mouseY) {
  if (currentMode.value !== 'edit') return;

  const canvas = canvasRef.value;
  const centerX = canvas.width / 2 + view.offsetX;
  const centerY = canvas.height / 2 + view.offsetY;

  // 吸附逻辑：先找到数学上最近的网格点
  const floatC = (mouseX - centerX) / GRID_GAP;
  const floatR = (mouseY - centerY) / GRID_GAP;
  const c = Math.round(floatC);
  const r = Math.round(floatR);

  // 计算到该网格点的实际距离
  const gridX = centerX + c * GRID_GAP;
  const gridY = centerY + r * GRID_GAP;
  const dist = Math.sqrt((mouseX - gridX)**2 + (mouseY - gridY)**2);

  // 增大后的判定范围
  if (dist < HIT_RADIUS) {
    selectPoint(r, c);
  }
}

function selectPoint(r, c) {
  saveState();
  const key = `${r},${c}`;
  
  if (!points.value[key]) {
    points.value[key] = { r, c, selectedCount: 0 };
  }
  points.value[key].selectedCount++;

  const route = routes.value[activeRouteIdx.value];
  if (route) {
    if (lastClickedPoint && lastClickedPoint !== key) {
       route.connections.push({ from: lastClickedPoint, to: key });
       route.logs.push(`(${lastClickedPoint}) -> (${key})`);
    }
  }
  lastClickedPoint = key;
}

// ==========================================
// 6. 路线管理
// ==========================================

function addNewRoute() {
  const newId = routes.value.length + 1;
  const color = ROUTE_COLORS[(newId - 1) % ROUTE_COLORS.length];
  
  routes.value.push({
    id: newId,
    color: color,
    connections: [],
    logs: []
  });
  
  activeRouteIdx.value = routes.value.length - 1;
  lastClickedPoint = null; 
}

function switchRoute(e) {
  activeRouteIdx.value = Number(e.target.value);
  lastClickedPoint = null; 
}

function toggleMode() {
  currentMode.value = currentMode.value === 'edit' ? 'run' : 'edit';
  particles.value = [];
  lastClickedPoint = null;
}

function saveState() {
  if (historyStack.value.length >= 50) historyStack.value.shift();
  historyStack.value.push({
    points: JSON.parse(JSON.stringify(points.value)),
    routes: JSON.parse(JSON.stringify(routes.value)),
    activeRouteIdx: activeRouteIdx.value,
    lastClickedPoint
  });
}

function undo() {
  if (historyStack.value.length === 0) return;
  const lastState = historyStack.value.pop();
  points.value = lastState.points;
  routes.value = lastState.routes;
  activeRouteIdx.value = lastState.activeRouteIdx;
  lastClickedPoint = lastState.lastClickedPoint;
}

// 【修改】清空当前路线（同时清空点亮状态）
function clearCurrentRoute() {
  saveState();
  const route = routes.value[activeRouteIdx.value];
  if (!route) return;

  // 1. 找出所有需要被减少计数的点
  const pointsToUpdate = new Set();
  
  // 收集连线中的点
  route.connections.forEach(conn => {
    pointsToUpdate.add(conn.from);
    pointsToUpdate.add(conn.to);
  });
  
  // 收集未连线但已点击的点 (当前悬空点)
  if (lastClickedPoint) {
    pointsToUpdate.add(lastClickedPoint);
  }

  // 2. 更新全局 points 状态
  pointsToUpdate.forEach(key => {
    if (points.value[key]) {
      points.value[key].selectedCount--;
      // 如果没有路线引用该点了，彻底删除，停止发光
      if (points.value[key].selectedCount <= 0) {
        delete points.value[key];
      }
    }
  });

  // 3. 重置路线数据
  route.connections = [];
  route.logs = [];
  lastClickedPoint = null;
}

function exportData() {
  const data = {
    points: points.value,
    routes: routes.value,
    gap: GRID_GAP
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'grid-routes.json';
  a.click();
  URL.revokeObjectURL(url);
}

function triggerImport() {
  fileInput.value.click();
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.routes) {
        saveState();
        points.value = data.points || {};
        routes.value = data.routes;
        activeRouteIdx.value = 0;
        lastClickedPoint = null;
      }
    } catch(e) { alert('文件解析错误'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function buildApiUrl(path) {
  return `${String(apiBase.value || '').replace(/\/$/, '')}${path}`;
}

function orderedPointKeys(route) {
  if (!route || route.connections.length === 0) {
    return lastClickedPoint ? [lastClickedPoint] : [];
  }
  return [route.connections[0].from, ...route.connections.map(conn => conn.to)];
}

function pathPoint(key, index, total) {
  const [row, col] = key.split(',').map(Number);
  const action = index === 0 ? 'start' : index === total - 1 ? 'feed' : 'pass';
  const point = {
    seq: index + 1,
    row,
    col,
    x: Number((col * Number(gridScaleM.value || 0.5)).toFixed(3)),
    y: Number((row * Number(gridScaleM.value || 0.5)).toFixed(3)),
    action
  };
  if (action === 'feed') point.feedAmount = Number(feedAmount.value || 0);
  return point;
}

async function submitCurrentRoute() {
  const route = routes.value[activeRouteIdx.value];
  const keys = orderedPointKeys(route);
  if (keys.length === 0) {
    apiMessage.value = '当前路线没有路径点';
    return;
  }
  const task = {
    taskID: `task-${Date.now()}`,
    deviceID: deviceID.value,
    gridScaleM: Number(gridScaleM.value || 0.5),
    robotPath: keys.map((key, index) => pathPoint(key, index, keys.length))
  };
  try {
    const response = await fetch(buildApiUrl('/api/pathSettings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    apiMessage.value = `已下发 ${keys.length} 个路径点`;
  } catch (error) {
    apiMessage.value = `下发失败: ${error}`;
  }
}

async function refreshDeviceStatus() {
  try {
    const response = await fetch(buildApiUrl(`/api/webget?deviceID=${encodeURIComponent(deviceID.value)}`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    apiMessage.value = JSON.stringify(data.data || data);
  } catch (error) {
    apiMessage.value = `状态失败: ${error}`;
  }
}

// ==========================================
// 7. 动画
// ==========================================

function startAnimation() {
  particles.value = [];
  const canvas = canvasRef.value;
  const centerX = canvas.width / 2 + view.offsetX;
  const centerY = canvas.height / 2 + view.offsetY;

  routes.value.forEach(route => {
    if (route.connections.length > 0) {
      const firstConn = route.connections[0];
      const [r, c] = firstConn.from.split(',').map(Number);
      
      particles.value.push({
        routeIdx: route.id,
        color: route.color, 
        connections: route.connections,
        targetConnIndex: 0,
        progress: 0, 
        speed: PARTICLE_SPEED, 
        x: centerX + c * GRID_GAP,
        y: centerY + r * GRID_GAP
      });
    }
  });
}

function updateParticles() {
  if (currentMode.value !== 'run') return;
  if (particles.value.length === 0) return;

  const canvas = canvasRef.value;
  const centerX = canvas.width / 2 + view.offsetX;
  const centerY = canvas.height / 2 + view.offsetY;

  for (let i = particles.value.length - 1; i >= 0; i--) {
    const p = particles.value[i];
    
    if (p.targetConnIndex >= p.connections.length) {
      particles.value.splice(i, 1);
      continue;
    }

    const conn = p.connections[p.targetConnIndex];
    const [r1, c1] = conn.from.split(',').map(Number);
    const [r2, c2] = conn.to.split(',').map(Number);

    const x1 = centerX + c1 * GRID_GAP;
    const y1 = centerY + r1 * GRID_GAP;
    const x2 = centerX + c2 * GRID_GAP;
    const y2 = centerY + r2 * GRID_GAP;

    p.progress += p.speed;
    
    if (p.progress >= 1) {
      p.progress = 0;
      p.targetConnIndex++;
      p.x = x2;
      p.y = y2;
    } else {
      p.x = x1 + (x2 - x1) * p.progress;
      p.y = y1 + (y2 - y1) * p.progress;
    }
  }
}
</script>

<style scoped>
.grid-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #1e1e1e;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  user-select: none;
}

.grid-canvas { display: block; cursor: grab; }
.grid-canvas:active { cursor: grabbing; }

/* 侧边栏 */
.sidebar {
  position: absolute;
  top: 20px;
  right: 0; 
  bottom: 140px; 
  width: 260px;
  background: rgba(30, 30, 30, 0.95);
  border-left: 1px solid #444;
  box-shadow: -2px 0 10px rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  z-index: 20;
}
.sidebar-hidden { transform: translateX(100%); }

.sidebar-toggle {
  position: absolute;
  left: -32px; 
  top: 10px;
  width: 32px;
  height: 80px;
  background: #333;
  border: 1px solid #444;
  border-right: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #ccc;
  box-shadow: -2px 0 5px rgba(0,0,0,0.2);
}
.sidebar-toggle:hover { background: #444; color: #fff; }

.toggle-icon { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
.toggle-text { font-size: 11px; writing-mode: vertical-rl; letter-spacing: 2px; }

.sidebar-header {
  padding: 15px;
  background: #252525;
  border-bottom: 1px solid #333;
  color: #eee;
  font-weight: bold;
  transition: border-color 0.3s;
}

.sidebar-content { flex: 1; overflow-y: auto; padding: 10px; }
.log-list { list-style: none; padding: 0; margin: 0; }
.log-item { padding: 6px 10px; border-bottom: 1px solid #333; font-family: monospace; font-size: 13px; }
.log-item .index { color: #666; margin-right: 8px; }
.empty-tip { text-align: center; color: #555; margin-top: 30px; font-size: 13px; line-height: 1.6; }

/* 底部面板优化 */
.bottom-panel {
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 30, 0.95);
  border: 1px solid #555;
  border-radius: 8px;
  padding: 8px 15px; 
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 5px 20px rgba(0,0,0,0.6);
  z-index: 30;
  max-width: 95vw;
  white-space: nowrap;
}

.viewer-link {
  color: #7de3ff;
  text-decoration: none;
  font-size: 12px;
  letter-spacing: 0.5px;
}

.api-panel {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: 92vw;
  color: #aaa;
  font-size: 12px;
}

.api-panel label {
  display: flex;
  align-items: center;
  gap: 4px;
}

.api-input {
  width: 88px;
  background: #111;
  border: 1px solid #444;
  color: #fff;
  padding: 4px 6px;
  border-radius: 3px;
}

.api-input.wide { width: 220px; }
.api-input.short { width: 58px; }
.api-message {
  max-width: 360px;
  overflow: hidden;
  color: #9ee7ff;
  text-overflow: ellipsis;
}
.submit-btn { background: #256; }

.mode-btn {
  background: #222; border: 1px dashed #666; color: #ddd; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.mode-btn:hover { background: #333; color: #fff; }

.panel-content { display: flex; justify-content: center; align-items: center; gap: 10px; }
.group { display: flex; align-items: center; gap: 6px; }

/* 路线管理器 */
.route-manager { background: #222; padding: 2px 6px; border-radius: 4px; border: 1px solid #444; }
.route-select { background: #333; color: white; border: 1px solid #555; padding: 2px; border-radius: 3px; max-width: 100px; }
.icon-btn { padding: 0 8px; font-size: 16px; line-height: 20px; font-weight: bold; }
.add-btn { background: #363; border-color: #484; }

/* 自定义输入框样式优化 */
.user-config-area { border: 1px solid #444; background: #252525; padding: 4px 8px; border-radius: 4px; }
.user-config-area .label { font-size: 12px; color: #aaa; margin-right: 5px; }
.input-wrapper { display: flex; align-items: center; gap: 2px; font-size: 12px; color: #888; }

.long-input {
  width: 70px;
  background: #111;
  border: 1px solid #444;
  color: #fff;
  padding: 4px;
  text-align: center;
  border-radius: 2px;
  font-family: monospace;
}

/* 隐藏上下箭头的 CSS */
input[type=number]::-webkit-inner-spin-button, 
input[type=number]::-webkit-outer-spin-button { 
  -webkit-appearance: none; 
  margin: 0; 
}
input[type=number] {
  -moz-appearance: textfield; 
}

.divider { width: 1px; height: 20px; background: #444; }

button {
  background: #444; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s;
}
button:hover { background: #555; }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.danger-btn { background: #722; }
.danger-btn:hover { background: #933; }
.save-btn { background: #246; }

.start-run-btn {
  background: linear-gradient(135deg, #bf40bf, #8a2be2);
  padding: 8px 25px;
  font-weight: bold;
  font-size: 13px;
}

/* 滚动条 */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
</style>
