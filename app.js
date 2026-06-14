// ================================
// 常量定义
// ================================
const DB_NAME = 'PuzzleTimerDB';
const DB_VERSION = 1;
const DEFAULT_COUNTDOWN_MINUTES = 60;
const TIMER_UPDATE_INTERVAL = 1000; // 1秒
const APP_VERSION = '1.1.4'; // 与 sw.js 保持一致
const DEBUG_LOG_MAX = 200;

// ================================
// 全局状态变量
// ================================
let db = null;
let currentPuzzle = null;
let timerInterval = null;
let countdownInterval = null;
let currentSession = null;
let countdownEndTime = null;
let countdownMinutes = DEFAULT_COUNTDOWN_MINUTES;
let timerStartTime = null;
let countdownTotalDuration = null;
let countdownAlarmTimeout = null;
let reminderTriggered = false;
let silentUnlockAudio = null;
let wakeLock = null;

// ================================
// 调试日志（手机端可查看）
// ================================
const debugLogs = [];

function debugLog(category, message, detail) {
  const entry = {
    time: new Date(),
    category,
    message,
    detail: detail ?? null
  };
  debugLogs.push(entry);
  if (debugLogs.length > DEBUG_LOG_MAX) {
    debugLogs.shift();
  }

  const detailStr = detail != null
    ? ` ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`
    : '';
  console.log(`[${category}] ${message}${detailStr}`);

  refreshDebugPanel();
}

function getDebugStatus() {
  return {
    timerRunning: !!timerInterval,
    wakeLock: wakeLock ? 'active' : ('wakeLock' in navigator ? 'inactive' : 'unsupported'),
    visibility: document.hidden ? 'hidden' : 'visible',
    countdownActive: countdownEndTime !== null,
    countdownRemainingMs: countdownEndTime !== null ? getCountdownRemaining() : null,
    alarmScheduled: !!countdownAlarmTimeout,
    reminderTriggered,
    notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported'
  };
}

function formatDebugTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderDebugLogs() {
  const container = document.getElementById('debug-log-list');
  if (!container) return;

  if (debugLogs.length === 0) {
    container.textContent = '暂无日志，开始计时或切换前后台后会出现记录。';
    return;
  }

  container.replaceChildren();
  debugLogs.slice().reverse().forEach((entry) => {
    const line = document.createElement('div');
    line.className = `debug-log-line debug-log-${entry.category}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'debug-log-time';
    timeSpan.textContent = formatDebugTime(entry.time);

    const catSpan = document.createElement('span');
    catSpan.className = 'debug-log-cat';
    catSpan.textContent = entry.category;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'debug-log-msg';
    msgSpan.textContent = entry.message;

    line.appendChild(timeSpan);
    line.appendChild(catSpan);
    line.appendChild(msgSpan);

    if (entry.detail != null) {
      const detailSpan = document.createElement('span');
      detailSpan.className = 'debug-log-detail';
      detailSpan.textContent = typeof entry.detail === 'object'
        ? JSON.stringify(entry.detail)
        : String(entry.detail);
      line.appendChild(detailSpan);
    }

    container.appendChild(line);
  });
}

function renderDebugStatus() {
  const container = document.getElementById('debug-status-chips');
  if (!container) return;

  const status = getDebugStatus();
  const remaining = status.countdownRemainingMs;
  const chips = [
    { label: '计时', value: status.timerRunning ? '运行中' : '未开始', ok: status.timerRunning },
    { label: '常亮', value: status.wakeLock, ok: status.wakeLock === 'active' },
    { label: '页面', value: status.visibility, ok: status.visibility === 'visible' },
    { label: '倒计时', value: status.countdownActive
      ? (remaining != null ? formatCountdownTime(remaining) : '--')
      : '未启用', ok: status.countdownActive },
    { label: '闹钟', value: status.alarmScheduled ? '已调度' : '未调度', ok: status.alarmScheduled },
    { label: '通知', value: status.notificationPermission, ok: status.notificationPermission === 'granted' }
  ];

  container.replaceChildren();
  chips.forEach(({ label, value, ok }) => {
    const chip = document.createElement('span');
    chip.className = `debug-status-chip ${ok ? 'ok' : 'warn'}`;
    chip.textContent = `${label}: ${value}`;
    container.appendChild(chip);
  });
}

function refreshDebugPanel() {
  const panel = document.getElementById('debug-panel');
  if (!panel || !panel.classList.contains('show')) return;
  renderDebugStatus();
  renderDebugLogs();
}

function initDebugPanel() {
  const toggleBtn = document.getElementById('debug-toggle-btn');
  const panel = document.getElementById('debug-panel');
  const closeBtn = document.getElementById('debug-close-btn');
  const clearBtn = document.getElementById('debug-clear-btn');
  const copyBtn = document.getElementById('debug-copy-btn');

  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener('click', () => {
    panel.classList.add('show');
    renderDebugStatus();
    renderDebugLogs();
    debugLog('system', '打开调试面板', getDebugStatus());
  });

  closeBtn?.addEventListener('click', () => {
    panel.classList.remove('show');
  });

  clearBtn?.addEventListener('click', () => {
    debugLogs.length = 0;
    renderDebugLogs();
    renderDebugStatus();
  });

  copyBtn?.addEventListener('click', async () => {
    const status = getDebugStatus();
    const header = `拼图计时器调试日志 v${APP_VERSION}\n状态: ${JSON.stringify(status)}\n\n`;
    const body = debugLogs.map((entry) => {
      const detail = entry.detail != null
        ? ` | ${typeof entry.detail === 'object' ? JSON.stringify(entry.detail) : entry.detail}`
        : '';
      return `${formatDebugTime(entry.time)} [${entry.category}] ${entry.message}${detail}`;
    }).join('\n');
    const text = header + body;

    try {
      await navigator.clipboard.writeText(text);
      debugLog('system', '日志已复制到剪贴板');
    } catch (e) {
      debugLog('system', '复制失败，请手动选择日志内容', e.message);
    }
  });

  debugLog('system', '调试面板已就绪', { version: APP_VERSION });
}

// ================================
// 工具函数
// ================================

// 错误处理工具函数
function handleError(error, context = 'Unknown') {
  console.error(`[${context}] Error:`, error);
  
  if (typeof error === 'object' && error.message) {
    console.error(`Error message: ${error.message}`);
    debugLog('error', `${context}: ${error.message}`);
  } else {
    debugLog('error', `${context}`, String(error));
  }
}

// 安全执行函数，捕获并处理异常
function safeExecute(fn, context = 'Unknown') {
  try {
    return fn();
  } catch (error) {
    handleError(error, context);
    return null;
  }
}

// 异步安全执行
async function safeExecuteAsync(fn, context = 'Unknown') {
  try {
    return await fn();
  } catch (error) {
    handleError(error, context);
    return null;
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error('DB open error:', request.error);
      reject(request.error);
    };
    
    request.onsuccess = () => {
      db = request.result;
      console.log('Database initialized successfully');
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('puzzles')) {
        const store = database.createObjectStore('puzzles', { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 倒计时显示（运行中）：初始 59 算第 1 秒，显示 0 时刚好走完设定时长
function formatCountdownTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000) - 1);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
}

function getTotalTime(puzzle) {
  if (!puzzle.sessions || puzzle.sessions.length === 0) return 0;
  return puzzle.sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
}

// 播放提示音（使用Web Audio API生成）
function playSound() {
  return safeExecute(() => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  }, 'playSound');
}

// 播放防沉迷结束提示音
let globalAudioContext = null;
let alarmAudio = null;
let audioInitialized = false;
let activeOscillators = []; // 保存活动的 oscillators 以便停止
let alarmTimeout = null; // 用于自动停止声音的定时器

// 初始化音频上下文（在用户交互时）
function initAudioContext() {
  if (!globalAudioContext) {
    try {
      globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error('无法创建音频上下文:', e);
      return;
    }
  }
  
  if (globalAudioContext.state === 'suspended') {
    globalAudioContext.resume().then(() => {
      audioInitialized = true;
      console.log('音频上下文已恢复');
    }).catch(err => {
      console.error('音频上下文恢复失败:', err);
    });
  } else if (globalAudioContext.state === 'running') {
    audioInitialized = true;
  }
}

// 在用户手势时解锁移动端音频播放（iOS Safari 必需）
async function unlockAudioPlayback() {
  initAudioContext();
  if (globalAudioContext?.state === 'suspended') {
    try {
      await globalAudioContext.resume();
      audioInitialized = true;
    } catch (e) {
      console.error('音频解锁失败:', e);
    }
  }
  if (!silentUnlockAudio) {
    silentUnlockAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    silentUnlockAudio.volume = 0.01;
  }
  try {
    await silentUnlockAudio.play();
    silentUnlockAudio.pause();
    silentUnlockAudio.currentTime = 0;
  } catch (e) {
    console.log('静音解锁播放被阻止:', e.message);
  }
}

async function playAlarmSound() {
  console.log('正在播放闹铃...');

  // 清除之前的自动停止定时器
  if (alarmTimeout) {
    clearTimeout(alarmTimeout);
    alarmTimeout = null;
  }

  // 使用 haptic 库进行震动反馈（优先）
  if (window.haptic) {
    try {
      // 触发多次震动反馈
      window.haptic.impact('heavy');
      setTimeout(() => window.haptic.impact('heavy'), 300);
      setTimeout(() => window.haptic.impact('heavy'), 600);
      setTimeout(() => window.haptic.notify('warning'), 900);
      console.log('Haptic 震动已触发');
    } catch (e) {
      console.log('Haptic 震动失败，使用原生震动:', e);
      // 回退到原生震动
      if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
      }
    }
  } else if (navigator.vibrate) {
    // 回退到原生震动
    navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
    console.log('原生震动已触发');
  }

  // iOS 需要用户交互后才能播放音频
  // 确保音频上下文已初始化并恢复
  if (!globalAudioContext) {
    initAudioContext();
  }
  if (globalAudioContext && globalAudioContext.state === 'suspended') {
    try {
      await globalAudioContext.resume();
      console.log('音频上下文已恢复');
    } catch (e) {
      console.error('音频上下文恢复失败:', e);
    }
  }

  // 尝试 Web Audio API
  await playAlarmWithWebAudio();

  // 尝试 HTML Audio
  await playAlarmWithHTMLAudio();

  // 5秒后自动停止声音
  alarmTimeout = setTimeout(() => {
    stopAlarmSound();
    console.log('闹铃已自动停止（5秒超时）');
  }, 3000);
}

async function playAlarmWithWebAudio() {
  try {
    if (!globalAudioContext) {
      initAudioContext();
    }
    
    if (!globalAudioContext) {
      console.error('无法创建音频上下文');
      return;
    }
    
    // 确保音频上下文正在运行
    if (globalAudioContext.state === 'suspended') {
      console.log('音频上下文暂停中，尝试恢复...');
      try {
        await globalAudioContext.resume();
        console.log('音频上下文恢复成功');
      } catch (err) {
        console.error('音频上下文恢复失败:', err);
      }
    }
    
    const now = globalAudioContext.currentTime;
    
    activeOscillators.forEach(item => {
      try {
        item.osc.stop();
      } catch (e) { /* ignore */ }
    });
    activeOscillators = [];
    
    // 创建多个蜂鸣声
    for (let i = 0; i < 5; i++) {
      const osc = globalAudioContext.createOscillator();
      const gain = globalAudioContext.createGain();
      
      osc.type = 'square';
      osc.connect(gain);
      gain.connect(globalAudioContext.destination);
      
      const beepStart = now + (i * 0.4);
      const beepEnd = beepStart + 0.25;
      
      // 使用更响亮的频率
      osc.frequency.setValueAtTime(1000, beepStart);
      osc.frequency.setValueAtTime(800, beepStart + 0.125);
      
      // 渐变音量
      gain.gain.setValueAtTime(0, beepStart);
      gain.gain.linearRampToValueAtTime(0.8, beepStart + 0.01);
      gain.gain.setValueAtTime(0.8, beepStart + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, beepEnd);
      
      // 保存 oscillator 引用以便停止
      activeOscillators.push({ osc, gain });
      
      osc.start(beepStart);
      osc.stop(beepEnd);
      
      // 播放完毕后从数组中移除
      setTimeout(() => {
        const index = activeOscillators.findIndex(item => item.osc === osc);
        if (index !== -1) {
          activeOscillators.splice(index, 1);
        }
      }, (i + 1) * 400);
    }
    
    console.log('Web Audio API 蜂鸣已启动');
  } catch (error) {
    console.error('Web Audio API 蜂鸣失败:', error);
  }
}

// 停止所有声音
function stopAlarmSound() {
  console.log('正在停止声音...');
  
  // 清除自动停止定时器
  if (alarmTimeout) {
    clearTimeout(alarmTimeout);
    alarmTimeout = null;
  }
  
  // 停止 HTML Audio
  if (alarmAudio) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    alarmAudio = null;
  }
  
  // 停止 Web Audio API oscillators
  activeOscillators.forEach(item => {
    try {
      item.gain.gain.exponentialRampToValueAtTime(0.001, globalAudioContext.currentTime + 0.1);
      item.osc.stop(globalAudioContext.currentTime + 0.1);
    } catch (e) {
      // 忽略错误
    }
  });
  activeOscillators = [];
}

async function playAlarmWithHTMLAudio() {
  try {
    if (alarmAudio) {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
      alarmAudio = null;
    }
    
    alarmAudio = new Audio('./sounds/alarm.mp3');
    alarmAudio.volume = 1.0;
    alarmAudio.loop = false;
    
    const playPromise = alarmAudio.play();
    if (playPromise !== undefined) {
      await playPromise.then(() => {
        console.log('MP3音频播放成功');
      }).catch(async () => {
        // MP3 不存在或被阻止时，用内嵌蜂鸣音回退
        alarmAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGWi77+efTRAMUKfj8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUrgc7y2Yk2CBlou+/nn00QDFCn4/C2YxwGOJHX8sx5LAUkd8fw3ZBAC');
        alarmAudio.volume = 1.0;
        await alarmAudio.play().catch(err => {
          console.log('内嵌音频播放被阻止:', err.message);
        });
      });
    }
  } catch (e) {
    console.log('HTML Audio 播放失败:', e);
  }
}

// 请求通知权限
async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

// 发送系统通知（模拟闹铃效果）
function sendAlarmNotification() {
  return safeExecute(async () => {
    if (!('Notification' in window)) {
      debugLog('notification', '浏览器不支持通知');
      return;
    }
    
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      debugLog('notification', '通知权限未授权', permission);
      return;
    }
    
    const notification = new Notification('拼图计时器', {
      body: '防沉迷时间已到！休息一下吧！',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      sound: 'default',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      tag: 'puzzle-timer-alarm'
    });
    
    // 点击通知时聚焦到应用
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    
    debugLog('notification', '系统通知已发送', { hidden: document.hidden });
    return notification;
  }, 'sendAlarmNotification');
}

function savePuzzle(puzzle) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readwrite');
    const store = transaction.objectStore('puzzles');
    const request = store.put(puzzle);
    
    request.onsuccess = () => {
      setTimeout(() => resolve(puzzle), 0);
    };
    request.onerror = () => reject(request.error);
  });
}

function getPuzzles() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readonly');
    const store = transaction.objectStore('puzzles');
    const request = store.getAll();
    
    request.onsuccess = () => {
      const puzzles = request.result.sort((a, b) => b.createdAt - a.createdAt);
      resolve(puzzles);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getPuzzleById(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readonly');
    const store = transaction.objectStore('puzzles');
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deletePuzzle(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['puzzles'], 'readwrite');
    const store = transaction.objectStore('puzzles');
    const request = store.delete(id);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    request.onerror = () => reject(request.error);
  });
}

function renderPuzzleList(puzzles) {
  console.log('renderPuzzleList called with puzzles:', puzzles);
  const listContainer = document.getElementById('puzzle-list');
  
  // 使用更安全的方式清空列表容器
  while (listContainer.firstChild) {
    listContainer.removeChild(listContainer.firstChild);
  }
  
  if (puzzles.length === 0) {
    console.log('No puzzles found, showing empty state');
    // 创建并显示空状态 - 使用DOM API替代innerHTML
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    emptyDiv.id = 'empty-state';
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'empty-icon';
    iconDiv.textContent = '🧩';
    
    const messageP = document.createElement('p');
    messageP.textContent = '还没有拼图记录';
    
    const hintP = document.createElement('p');
    hintP.className = 'empty-hint';
    hintP.textContent = '点击上方输入框添加第一个拼图';
    
    emptyDiv.appendChild(iconDiv);
    emptyDiv.appendChild(messageP);
    emptyDiv.appendChild(hintP);
    listContainer.appendChild(emptyDiv);
  } else {
    console.log(`Rendering ${puzzles.length} puzzles`);
    
    // 渲染拼图列表 - 使用DOM API替代innerHTML
    puzzles.forEach(puzzle => {
      const totalTime = formatTime(getTotalTime(puzzle));
      let subtitle = '';
      if (puzzle.brand && puzzle.pieces) {
        subtitle = `${puzzle.brand} · ${puzzle.pieces}片`;
      } else if (puzzle.brand) {
        subtitle = puzzle.brand;
      } else if (puzzle.pieces) {
        subtitle = `${puzzle.pieces}片`;
      }
      
      const itemDiv = document.createElement('div');
      itemDiv.className = 'puzzle-item';
      itemDiv.dataset.id = puzzle.id;
      
      const mainDiv = document.createElement('div');
      mainDiv.className = 'puzzle-item-main';
      
      const nameDiv = document.createElement('div');
      nameDiv.className = 'puzzle-item-name';
      nameDiv.textContent = puzzle.name;
      
      mainDiv.appendChild(nameDiv);
      
      if (subtitle) {
        const subtitleDiv = document.createElement('div');
        subtitleDiv.className = 'puzzle-item-subtitle';
        subtitleDiv.textContent = subtitle;
        mainDiv.appendChild(subtitleDiv);
      }
      
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'puzzle-item-actions';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'puzzle-item-time';
      timeSpan.textContent = totalTime;
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete-item';
      deleteBtn.dataset.id = puzzle.id;
      deleteBtn.title = '删除拼图';
      deleteBtn.textContent = '×';
      
      actionsDiv.appendChild(timeSpan);
      actionsDiv.appendChild(deleteBtn);
      
      itemDiv.appendChild(mainDiv);
      itemDiv.appendChild(actionsDiv);
      
      listContainer.appendChild(itemDiv);
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  document.getElementById(pageId).classList.add('active');
}

function showModal(modalId) {
  document.getElementById(modalId).classList.add('show');
}

function hideModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

function updateStats() {
  if (!currentPuzzle) return;
  
  const totalTime = getTotalTime(currentPuzzle);
  const sessionCount = currentPuzzle.sessions ? currentPuzzle.sessions.length : 0;
  const avgTime = sessionCount > 0 ? Math.floor(totalTime / sessionCount) : 0;
  
  document.getElementById('total-time').textContent = formatTime(totalTime);
  document.getElementById('session-count').textContent = sessionCount;
  document.getElementById('avg-time').textContent = formatTime(avgTime);
}

function renderSessions() {
  const sessionList = document.getElementById('session-list');
  
  // 清空会话列表
  while (sessionList.firstChild) {
    sessionList.removeChild(sessionList.firstChild);
  }
  
  if (!currentPuzzle || !currentPuzzle.sessions || currentPuzzle.sessions.length === 0) {
    // 使用DOM API创建空状态
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-sessions';
    
    const emptyP = document.createElement('p');
    emptyP.textContent = '暂无分段记录';
    
    emptyDiv.appendChild(emptyP);
    sessionList.appendChild(emptyDiv);
    return;
  }
  
  const sessions = currentPuzzle.sessions
    .map((session, index) => ({ session, index }))
    .reverse();
  
  // 使用DOM API创建会话项
  sessions.forEach(({ session, index: sessionIndex }) => {
    const sessionItem = document.createElement('div');
    sessionItem.className = 'session-item';
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'session-time';
    let timeText = formatTime(session.duration);
    if (session.type === 'adjustment') {
      const sign = session.adjustMinutes > 0 ? '+' : '-';
      timeText = sign + formatTime(Math.abs(session.duration));
      timeDiv.classList.add('session-time-adjusted');
      timeDiv.textContent = timeText + ' ✏️';
    } else {
      timeDiv.textContent = timeText;
    }
    
    const centerDiv = document.createElement('div');
    centerDiv.className = 'session-center';
    if (session.type === 'adjustment' && session.note) {
      const noteSpan = document.createElement('span');
      noteSpan.className = 'session-reason';
      noteSpan.textContent = session.note;
      centerDiv.appendChild(noteSpan);
    }
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'session-actions';
    
    const dateDiv = document.createElement('div');
    dateDiv.className = 'session-date';
    dateDiv.textContent = formatDate(session.date || session.startTime);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-item btn-delete-session';
    deleteBtn.dataset.sessionIndex = sessionIndex;
    deleteBtn.title = '删除记录';
    deleteBtn.textContent = '×';
    
    actionsDiv.appendChild(dateDiv);
    actionsDiv.appendChild(deleteBtn);
    
    sessionItem.appendChild(timeDiv);
    sessionItem.appendChild(centerDiv);
    sessionItem.appendChild(actionsDiv);
    
    sessionList.appendChild(sessionItem);
  });
}

function openDeleteSessionModal(puzzleId, sessionIndex) {
  window.deleteSessionData = { puzzleId, sessionIndex };
  showModal('modal-delete-session');
}

function getCountdownRemaining() {
  if (countdownEndTime === null) return null;
  return countdownEndTime - Date.now();
}

function tickTimers() {
  if (!timerStartTime || !currentSession) return;
  
  const elapsed = Date.now() - timerStartTime;
  currentSession.duration = elapsed;
  document.getElementById('current-time').textContent = formatTime(elapsed);
  
  if (countdownEndTime !== null) {
    updateCountdownDisplay(getCountdownRemaining());
  }
}

function scheduleCountdownAlarm() {
  if (countdownAlarmTimeout) {
    clearTimeout(countdownAlarmTimeout);
    countdownAlarmTimeout = null;
  }
  if (countdownEndTime === null) return;
  
  const delay = countdownEndTime - Date.now();
  if (delay <= 0) {
    debugLog('countdown', '闹钟调度：已到期，立即触发', { delay });
    updateCountdownDisplay(0);
    return;
  }
  
  countdownAlarmTimeout = setTimeout(() => {
    countdownAlarmTimeout = null;
    debugLog('countdown', 'setTimeout 闹钟触发', {
      endTime: new Date(countdownEndTime).toLocaleTimeString('zh-CN'),
      now: new Date().toLocaleTimeString('zh-CN'),
      hidden: document.hidden
    });
    if (countdownEndTime !== null && Date.now() >= countdownEndTime) {
      updateCountdownDisplay(0);
    }
  }, delay);

  debugLog('countdown', '闹钟已调度', {
    delayMs: delay,
    fireAt: new Date(countdownEndTime).toLocaleTimeString('zh-CN'),
    hidden: document.hidden
  });
}

async function startTimer() {
  timerStartTime = Date.now();
  debugLog('timer', '开始计时', { startTime: new Date(timerStartTime).toLocaleTimeString('zh-CN') });

  currentSession = {
    id: generateId(),
    startTime: timerStartTime,
    endTime: null,
    duration: 0
  };

  if (!currentPuzzle.sessions) {
    currentPuzzle.sessions = [];
  }
  currentPuzzle.sessions.push(currentSession);

  // 立即初始化倒计时并启动 interval，避免 await 期间秒数跳变
  if (document.getElementById('countdown-enabled').checked) {
    startCountdown();
  }

  timerInterval = setInterval(tickTimers, TIMER_UPDATE_INTERVAL);
  tickTimers();

  await unlockAudioPlayback();
  preloadAudio();
  requestNotificationPermission();
  requestScreenWakeLock();
  
  document.getElementById('timer-btn').textContent = '结束计时';
  document.getElementById('timer-btn').classList.remove('start');
  document.getElementById('timer-btn').classList.add('stop');
}

function startCountdown() {
  countdownTotalDuration = countdownMinutes * 60 * 1000;
  countdownEndTime = Date.now() + countdownTotalDuration;
  reminderTriggered = false;
  
  debugLog('countdown', '倒计时启动', {
    minutes: countdownMinutes,
    endTime: new Date(countdownEndTime).toLocaleTimeString('zh-CN'),
    display: formatCountdownTime(getCountdownRemaining())
  });

  updateCountdownDisplay(getCountdownRemaining());
  scheduleCountdownAlarm();
}

function updateCountdownDisplay(remaining) {
  if (remaining <= 0) {
    if (!reminderTriggered) {
      debugLog('countdown', '倒计时到期，触发提醒', {
        source: document.hidden ? '后台/不可见' : '前台',
        wakeLock: wakeLock ? 'active' : 'inactive'
      });
      reminderTriggered = true;
      stopCountdown();
      showReminder();
    }
    return;
  }
  
  const countdownTimeEl = document.getElementById('countdown-time');
  countdownTimeEl.textContent = formatCountdownTime(remaining);
  
  if (remaining < 60000) {
    countdownTimeEl.classList.remove('warning');
    countdownTimeEl.classList.add('danger');
  } else if (remaining < 300000) {
    countdownTimeEl.classList.remove('danger');
    countdownTimeEl.classList.add('warning');
  } else {
    countdownTimeEl.classList.remove('warning', 'danger');
  }
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (countdownAlarmTimeout) {
    clearTimeout(countdownAlarmTimeout);
    countdownAlarmTimeout = null;
  }
  if (countdownEndTime !== null) {
    debugLog('countdown', '倒计时停止');
  }
  countdownEndTime = null;
  countdownTotalDuration = null;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  debugLog('timer', '结束计时', {
    elapsed: timerStartTime ? formatTime(Date.now() - timerStartTime) : '--'
  });

  stopCountdown();
  timerStartTime = null;
  reminderTriggered = false;
  
  if (wakeLock) {
    debugLog('wakeLock', '结束计时，释放常亮');
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  
  // 重置后台计时状态
  backgroundTimerStart = null;
  backgroundTimerPaused = false;
  
  if (currentSession) {
    currentSession.endTime = Date.now();
    currentSession.duration = currentSession.endTime - currentSession.startTime;
  }
  
  savePuzzle(currentPuzzle).then(() => {
    updateStats();
    renderSessions();
    // 刷新拼图列表（更新总时间显示）
    getPuzzles().then(renderPuzzleList);
  });
  
  document.getElementById('current-time').textContent = '00:00:00';
  document.getElementById('timer-btn').textContent = '开始计时';
  document.getElementById('timer-btn').classList.remove('stop');
  document.getElementById('timer-btn').classList.add('start');
  
  // 如果防沉迷已启用，保持上次的设置不变
  const countdownEnabled = document.getElementById('countdown-enabled');
  if (countdownEnabled && countdownEnabled.checked) {
    // 根据当前的 countdownMinutes 值更新预设按钮选中状态
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    const presetBtn = document.querySelector(`.btn-preset[data-minutes="${countdownMinutes}"]`);
    if (presetBtn) {
      presetBtn.classList.add('active');
    }
    // 更新剩余时间显示（保持上次设置的时间）
    document.getElementById('countdown-time').textContent = formatTime(countdownMinutes * 60 * 1000);
    document.getElementById('countdown-time').classList.remove('warning', 'danger');
  } else {
    document.getElementById('countdown-time').textContent = '--:--:--';
    document.getElementById('countdown-time').classList.remove('warning', 'danger');
  }
}

// ================================
// 屏幕常亮和后台计时功能
// ================================

// 请求屏幕常亮权限（开始计时时申请，避免后台 interval 被过度节流）
async function requestScreenWakeLock() {
  if (!('wakeLock' in navigator)) {
    debugLog('wakeLock', '设备不支持 Wake Lock API');
    return null;
  }
  try {
    if (wakeLock) {
      await wakeLock.release().catch(() => {});
    }
    wakeLock = await navigator.wakeLock.request('screen');
    debugLog('wakeLock', '屏幕常亮已启用', { hidden: document.hidden });
    wakeLock.addEventListener('release', () => {
      debugLog('wakeLock', '屏幕常亮已释放（系统或切页）', { hidden: document.hidden });
      wakeLock = null;
      refreshDebugPanel();
    });
    refreshDebugPanel();
    return wakeLock;
  } catch (err) {
    debugLog('wakeLock', '屏幕常亮申请失败', err.message);
    return null;
  }
}

// 后台计时状态
let backgroundTimerStart = null;
let backgroundTimerPaused = false;

// 处理应用进入后台
function handleAppBackground() {
  if (!currentSession || !timerInterval) return;
  backgroundTimerStart = Date.now();
  backgroundTimerPaused = false;
  debugLog('visibility', '进入后台', {
    wakeLock: wakeLock ? 'active' : 'inactive',
    countdownRemaining: countdownEndTime ? formatCountdownTime(getCountdownRemaining()) : '--',
    alarmScheduled: !!countdownAlarmTimeout
  });
}

// 处理应用恢复前台
async function handleAppForeground() {
  if (!currentSession || !timerInterval) return;
  
  const bgDuration = backgroundTimerStart ? Date.now() - backgroundTimerStart : 0;
  debugLog('visibility', '回到前台', {
    backgroundDuration: bgDuration ? formatTime(bgDuration) : '--',
    wakeLock: wakeLock ? 'active' : 'inactive',
    countdownRemaining: countdownEndTime ? formatCountdownTime(getCountdownRemaining()) : '--'
  });

  await unlockAudioPlayback();
  tickTimers();
  
  if (countdownEndTime !== null) {
    const remaining = getCountdownRemaining();
    if (remaining <= 0) {
      debugLog('countdown', '前台校准：倒计时已过期，补触发提醒', { remaining });
      if (!reminderTriggered) {
        reminderTriggered = true;
        stopCountdown();
        await showReminder();
      }
    } else {
      document.getElementById('countdown-time').textContent = formatCountdownTime(remaining);
      scheduleCountdownAlarm();
    }
  }
  
  if (backgroundTimerStart) {
    backgroundTimerStart = null;
  }
  
  if (wakeLock === null && timerInterval) {
    debugLog('wakeLock', '前台恢复，重新申请常亮');
    requestScreenWakeLock();
  }

  refreshDebugPanel();
}

function updateVersionDisplay() {
  const currentVersionEl = document.getElementById('current-version');
  const versionStatusEl = document.getElementById('version-status');
  
  if (currentVersionEl) {
    currentVersionEl.textContent = 'v' + APP_VERSION;
  }
  
  if (swRegistration && swRegistration.waiting) {
    versionStatusEl.textContent = '有新版本可用';
    versionStatusEl.className = 'version-status outdated';
  } else {
    versionStatusEl.textContent = '已是最新版本';
    versionStatusEl.className = 'version-status latest';
  }
}

// 从服务器获取最新版本号
async function fetchLatestVersion() {
  try {
    const response = await fetch('./version.json', {
      cache: 'no-cache',
      timeout: 3000
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.version;
    }
  } catch (error) {
    console.log('无法获取服务器版本:', error.message);
  }
  return null;
}

// 检查服务器版本并更新显示
async function checkServerVersion() {
  const latestVersion = await fetchLatestVersion();
  const versionStatusEl = document.getElementById('version-status');
  
  if (!latestVersion) {
    // 如果无法获取服务器版本，使用原有逻辑
    updateVersionDisplay();
    return;
  }
  
  const currentVersionEl = document.getElementById('current-version');
  if (currentVersionEl) {
    currentVersionEl.textContent = 'v' + APP_VERSION;
  }
  
  // 比较版本号
  if (compareVersions(latestVersion, APP_VERSION) > 0) {
    versionStatusEl.textContent = `最新版本 v${latestVersion}`;
    versionStatusEl.className = 'version-status outdated';
    // 触发 Service Worker 更新检查
    if (swRegistration) {
      swRegistration.update().then(() => {
        if (swRegistration.waiting) {
          showUpdateNotification();
        }
      });
    }
  } else {
    versionStatusEl.textContent = '已是最新版本';
    versionStatusEl.className = 'version-status latest';
  }
}

// 预加载音频（在用户首次交互时调用）
function preloadAudio() {
  try {
    // 预加载 MP3（不播放，只加载）
    alarmAudio = new Audio('./sounds/alarm.mp3');
    alarmAudio.volume = 1.0;
    alarmAudio.load();
    console.log('音频已预加载');
    
    // 初始化音频上下文
    initAudioContext();
  } catch (e) {
    console.log('音频预加载失败:', e);
  }
}

// 版本号比较函数
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  const length = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < length; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

async function showReminder() {
  debugLog('alarm', '开始播放提醒', {
    hidden: document.hidden,
    wakeLock: wakeLock ? 'active' : 'inactive',
    notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported'
  });

  await sendAlarmNotification();
  
  await unlockAudioPlayback();
  await playAlarmSound();
  
  debugLog('alarm', '提醒流程完成（通知+音频）');
  
  showModal('modal-reminder');
  
  const countdownEnabled = document.getElementById('countdown-enabled');
  if (countdownEnabled.checked) {
    countdownEnabled.checked = false;
    document.getElementById('countdown-options').classList.remove('show');
  }
}

async function init() {
  await openDB();
  initDebugPanel();
  
  const puzzles = await getPuzzles();
  renderPuzzleList(puzzles);
  
  // 检查服务器版本并更新显示
  checkServerVersion();
  
  // 首次用户交互时预加载音频
  document.addEventListener('click', preloadAudio, { once: true });
  document.addEventListener('touchstart', preloadAudio, { once: true });
  
  // 确保防沉迷默认选中（只有在元素存在时）
  const countdownEnabled = document.getElementById('countdown-enabled');
  const countdownOptions = document.getElementById('countdown-options');
  const countdownTime = document.getElementById('countdown-time');
  
  if (countdownEnabled) {
    countdownEnabled.checked = true;
  }
  if (countdownOptions) {
    countdownOptions.classList.add('show');
  }
  // 初始化倒计时显示（默认60分钟）- 只有在元素存在时设置
  if (countdownTime) {
    countdownTime.textContent = formatTime(DEFAULT_COUNTDOWN_MINUTES * 60 * 1000);
    countdownTime.classList.remove('warning', 'danger');
  }
  
  // 统计按钮
  document.getElementById('stats-btn').addEventListener('click', async () => {
    await renderStatsPage();
    showPage('page-stats');
  });
  
  // 统计页面返回按钮
  document.getElementById('stats-back-btn').addEventListener('click', () => {
    showPage('page-home');
  });
  
  // 日历导航按钮（使用事件委托）
  document.addEventListener('click', (e) => {
    if (e.target.id === 'calendar-prev') {
      prevMonth();
    } else if (e.target.id === 'calendar-next') {
      nextMonth();
    }
  });
  
  document.getElementById('session-list').addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete-session');
    if (!deleteBtn || !currentPuzzle) return;
    
    e.stopPropagation();
    openDeleteSessionModal(currentPuzzle.id, parseInt(deleteBtn.dataset.sessionIndex, 10));
  });
  
  // 取消删除记录
  document.getElementById('cancel-delete-session').addEventListener('click', () => {
    window.deleteSessionData = null;
    hideModal('modal-delete-session');
  });
  
  // 确认删除记录
  document.getElementById('confirm-delete-session').addEventListener('click', async () => {
    if (window.deleteSessionData) {
      const { puzzleId, sessionIndex } = window.deleteSessionData;
      const puzzles = await getPuzzles();
      const puzzle = puzzles.find(p => p.id === puzzleId);
      if (puzzle && puzzle.sessions) {
        puzzle.sessions.splice(sessionIndex, 1);
        await savePuzzle(puzzle);
        
        if (currentPuzzle && currentPuzzle.id === puzzleId) {
          currentPuzzle = puzzle;
          updateStats();
          renderSessions();
        }
      }
    }
    
    window.deleteSessionData = null;
    hideModal('modal-delete-session');
  });
  
  document.getElementById('add-puzzle-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('puzzle-name-input');
    const brandInput = document.getElementById('puzzle-brand-input');
    const piecesInput = document.getElementById('puzzle-pieces-input');
    
    const name = nameInput.value.trim();
    
    if (!name) {
      nameInput.focus();
      return;
    }
    
    const puzzle = {
      id: generateId(),
      name,
      brand: brandInput.value.trim() || null,
      pieces: piecesInput.value ? parseInt(piecesInput.value) : null,
      createdAt: Date.now(),
      sessions: []
    };
    
    await savePuzzle(puzzle);
    nameInput.value = '';
    brandInput.value = '';
    piecesInput.value = '';
    
    // 等待数据写入完成
    setTimeout(async () => {
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
    }, 50);
  });
  
  // 添加拼图（名称输入框回车）
  document.getElementById('puzzle-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-puzzle-btn').click();
    }
  });
  
  // 品牌和片数输入框回车也触发添加
  document.getElementById('puzzle-brand-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-puzzle-btn').click();
    }
  });
  
  document.getElementById('puzzle-pieces-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('add-puzzle-btn').click();
    }
  });
  
  document.getElementById('puzzle-list').addEventListener('click', async (e) => {
    // 检查是否点击的是删除按钮
    const deleteBtn = e.target.closest('.btn-delete-item');
    if (deleteBtn) {
      e.stopPropagation();
      const puzzleId = deleteBtn.dataset.id;
      const puzzle = await getPuzzleById(puzzleId);
      if (puzzle) {
        document.getElementById('delete-list-message').textContent = 
          `确定要删除"${puzzle.name}"吗？所有计时数据将被删除，此操作无法撤销。`;
        document.getElementById('modal-delete-list').classList.add('show');
        // 存储要删除的ID
        document.getElementById('confirm-delete-list').dataset.deleteId = puzzleId;
      }
      return;
    }
    
    // 检查是否点击的是拼图项
    const item = e.target.closest('.puzzle-item');
    if (!item) return;
    
    const id = item.dataset.id;
    currentPuzzle = await getPuzzleById(id);
    
    if (currentPuzzle) {
      document.getElementById('detail-title').textContent = currentPuzzle.name;
      
      // 显示拼图信息
      const infoCard = document.getElementById('puzzle-info-card');
      const brandEl = document.getElementById('puzzle-brand');
      const piecesEl = document.getElementById('puzzle-pieces');
      
      if (currentPuzzle.brand || currentPuzzle.pieces) {
        infoCard.style.display = 'flex';
        brandEl.textContent = currentPuzzle.brand || '-';
        piecesEl.textContent = currentPuzzle.pieces ? `${currentPuzzle.pieces}片` : '-';
      } else {
        infoCard.style.display = 'none';
      }
      
      updateStats();
      renderSessions();
      
      // 切换拼图时自动选中防沉迷并重置倒计时
      const countdownEnabled = document.getElementById('countdown-enabled');
      countdownEnabled.checked = true;
      document.getElementById('countdown-options').classList.add('show');
      stopCountdown();
      document.getElementById('countdown-time').textContent = formatTime(DEFAULT_COUNTDOWN_MINUTES * 60 * 1000);
      document.getElementById('countdown-time').classList.remove('warning', 'danger');
      
      showPage('page-detail');
    }
  });
  
  // 列表删除确认
  document.getElementById('cancel-delete-list').addEventListener('click', () => {
    hideModal('modal-delete-list');
  });
  
  document.getElementById('confirm-delete-list').addEventListener('click', async () => {
    const deleteId = document.getElementById('confirm-delete-list').dataset.deleteId;
    if (deleteId) {
      await deletePuzzle(deleteId);
      hideModal('modal-delete-list');
      
      // 如果当前在详情页且删除的是当前拼图，返回首页
      if (currentPuzzle && currentPuzzle.id === deleteId) {
        currentPuzzle = null;
        if (timerInterval) {
          stopTimer();
        }
        showPage('page-home');
      }
      
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
    }
  });
  
  document.getElementById('back-btn').addEventListener('click', async () => {
    if (timerInterval) {
      stopTimer();
    }
    currentPuzzle = null;
    
    const puzzles = await getPuzzles();
    renderPuzzleList(puzzles);
    
    showPage('page-home');
  });
  
  document.getElementById('delete-btn').addEventListener('click', () => {
    showModal('modal-delete');
  });
  
  document.getElementById('cancel-delete').addEventListener('click', () => {
    hideModal('modal-delete');
  });
  
  document.getElementById('confirm-delete').addEventListener('click', async () => {
    if (currentPuzzle) {
      await deletePuzzle(currentPuzzle.id);
      hideModal('modal-delete');
      currentPuzzle = null;
      
      const puzzles = await getPuzzles();
      renderPuzzleList(puzzles);
      showPage('page-home');
    }
  });
  
  // 编辑拼图时长
  window.showEditPuzzleTimeModal = function() {
    if (!currentPuzzle) return;
    showModal('modal-edit-puzzle-time');
    document.getElementById('edit-puzzle-time-input').value = '';
    document.getElementById('edit-puzzle-note-input').value = '';
  };
  
  document.getElementById('cancel-edit-puzzle-time').addEventListener('click', () => {
    hideModal('modal-edit-puzzle-time');
  });
  
  document.getElementById('confirm-edit-puzzle-time').addEventListener('click', async () => {
    const timeInput = document.getElementById('edit-puzzle-time-input');
    const noteInput = document.getElementById('edit-puzzle-note-input');
    const minutes = parseInt(timeInput.value);
    const note = noteInput.value.trim();
    
    if (isNaN(minutes) || minutes === 0) {
      alert('请输入有效的分钟数（正数增加，负数减少）');
      return;
    }
    
    const diffMs = minutes * 60 * 1000;
    
    if (!currentPuzzle) {
      hideModal('modal-edit-puzzle-time');
      return;
    }
    
    if (!currentPuzzle.sessions) {
      currentPuzzle.sessions = [];
    }
    
    const adjustmentSession = {
      duration: diffMs,
      adjusted: true,
      adjustMinutes: minutes,
      note: note || '',
      date: new Date().toISOString(),
      type: 'adjustment'
    };
    
    currentPuzzle.sessions.push(adjustmentSession);
    await savePuzzle(currentPuzzle);
    
    currentPuzzle = await getPuzzleById(currentPuzzle.id);
    updateStats();
    renderSessions();
    
    timeInput.value = '';
    noteInput.value = '';
    hideModal('modal-edit-puzzle-time');
  });
  
  document.getElementById('timer-btn').addEventListener('click', () => {
    if (timerInterval) {
      stopTimer();
    } else {
      startTimer();
    }
  });
  
  document.getElementById('countdown-enabled').addEventListener('change', (e) => {
    const options = document.getElementById('countdown-options');
    if (e.target.checked) {
      options.classList.add('show');
      if (timerInterval) {
        startCountdown();
      } else {
        document.getElementById('countdown-time').textContent = formatTime(countdownMinutes * 60 * 1000);
        document.getElementById('countdown-time').classList.remove('warning', 'danger');
      }
    } else {
      options.classList.remove('show');
      stopCountdown();
      reminderTriggered = false;
      document.getElementById('countdown-time').textContent = '--:--:--';
      document.getElementById('countdown-time').classList.remove('warning', 'danger');
    }
  });
  
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      countdownMinutes = parseInt(btn.dataset.minutes);
      
      // 更新剩余时间显示
      document.getElementById('countdown-time').textContent = formatTime(countdownMinutes * 60 * 1000);
      document.getElementById('countdown-time').classList.remove('warning', 'danger');
      
      // 如果计时器正在运行且防沉迷已启用，重新设置倒计时
      if (timerInterval && document.getElementById('countdown-enabled').checked) {
        stopCountdown();
        startCountdown();
      }
    });
  });
  
  document.getElementById('set-custom-btn').addEventListener('click', () => {
    const customInput = document.getElementById('custom-minutes-input');
    const minutes = parseInt(customInput.value);
    
    if (!minutes || minutes < 1) {
      customInput.focus();
      return;
    }
    
    // 清除预设按钮的激活状态
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    countdownMinutes = minutes;
    
    // 更新剩余时间显示
    document.getElementById('countdown-time').textContent = formatTime(countdownMinutes * 60 * 1000);
    document.getElementById('countdown-time').classList.remove('warning', 'danger');
    
    // 如果计时器正在运行且防沉迷已启用，重新设置倒计时
    if (timerInterval && document.getElementById('countdown-enabled').checked) {
      stopCountdown();
      startCountdown();
    }
    
    // 可以给用户一个视觉反馈
    const btn = document.getElementById('set-custom-btn');
    const originalText = btn.textContent;
    btn.textContent = '已设置';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1000);
  });
  
  document.getElementById('reminder-rest').addEventListener('click', () => {
    hideModal('modal-reminder');
    stopAlarmSound(); // 停止所有声音
    if (timerInterval) {
      stopTimer();
    }
  });
  
  document.getElementById('reminder-continue').addEventListener('click', () => {
    hideModal('modal-reminder');
    stopAlarmSound(); // 停止所有声音
  });
  
  document.addEventListener('visibilitychange', () => {
    debugLog('visibility', document.hidden ? 'document.hidden=true' : 'document.hidden=false');
    if (document.hidden) {
      handleAppBackground();
    } else {
      handleAppForeground();
      if (timerInterval) {
        requestScreenWakeLock();
      }
    }
  });
  
  // 统计页面相关函数
  async function calculateTotalTime() {
    const puzzles = await getPuzzles();
    let total = 0;
    puzzles.forEach(puzzle => {
      if (puzzle.sessions) {
        puzzle.sessions.forEach(session => {
          total += session.duration || 0;
        });
      }
    });
    return total;
  }
  
  async function calculateTotalPieces() {
    const puzzles = await getPuzzles();
    let total = 0;
    puzzles.forEach(puzzle => {
      total += parseInt(puzzle.pieces) || 0;
    });
    return total;
  }
  
  async function getBrandDistribution() {
    const puzzles = await getPuzzles();
    const distribution = {};
    puzzles.forEach(puzzle => {
      const brand = puzzle.brand || '未分类';
      if (!distribution[brand]) {
        distribution[brand] = { count: 0, pieces: 0, time: 0 };
      }
      distribution[brand].count++;
      distribution[brand].pieces += parseInt(puzzle.pieces) || 0;
      if (puzzle.sessions) {
        puzzle.sessions.forEach(session => {
          distribution[brand].time += session.duration || 0;
        });
      }
    });
    return distribution;
  }
  
  async function getPiecesDistribution() {
    const puzzles = await getPuzzles();
    const distribution = {};
    puzzles.forEach(puzzle => {
      const pieces = parseInt(puzzle.pieces) || 0;
      let range = '其他';
      if (pieces > 0 && pieces <= 500) range = '500片以下';
      else if (pieces <= 1000) range = '501-1000片';
      else if (pieces <= 2000) range = '1001-2000片';
      else if (pieces > 2000) range = '2000片以上';
      
      if (!distribution[range]) {
        distribution[range] = { count: 0, pieces: 0, time: 0 };
      }
      distribution[range].count++;
      distribution[range].pieces += pieces;
      if (puzzle.sessions) {
        puzzle.sessions.forEach(session => {
          distribution[range].time += session.duration || 0;
        });
      }
    });
    return distribution;
  }
  
  function parseTime(timeStr) {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0]);
      const minutes = parseInt(parts[1]);
      const seconds = parseInt(parts[2]);
      if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
        return (hours * 3600 + minutes * 60 + seconds) * 1000;
      }
    }
    return null;
  }
  
  async function renderStatsPage() {
    const puzzles = await getPuzzles();
    
    // 计算统计数据
    const totalTime = await calculateTotalTime();
    const totalPieces = await calculateTotalPieces();
    const totalPuzzles = puzzles.length;
    const avgTimePerPiece = totalPieces > 0 ? (totalTime / totalPieces / 1000).toFixed(2) : '0.00';
    
    // 更新总体统计
    document.getElementById('stats-total-puzzles').textContent = totalPuzzles;
    document.getElementById('stats-total-pieces').textContent = totalPieces;
    document.getElementById('stats-total-time').textContent = formatTime(totalTime);
    document.getElementById('stats-avg-time-per-piece').textContent = avgTimePerPiece;
    
    // 更新品牌分布
    const brandDistribution = await getBrandDistribution();
    renderDistribution('brand-distribution', brandDistribution);
    
    // 更新片数分布
    const piecesDistribution = await getPiecesDistribution();
    renderDistribution('pieces-distribution', piecesDistribution);
    
    // 渲染月度日历
    const today = new Date();
    currentCalendarYear = today.getFullYear();
    currentCalendarMonth = today.getMonth();
    await renderCalendar(currentCalendarYear, currentCalendarMonth);
  }
  
  function renderDistribution(containerId, distribution) {
    const container = document.getElementById(containerId);
    const entries = Object.entries(distribution);
    
    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无数据</div>';
      return;
    }
    
    // 计算最大值用于百分比计算
    const maxCount = Math.max(...entries.map(([, data]) => data.count));
    
    container.innerHTML = entries.map(([name, data]) => {
      const percentage = maxCount > 0 ? (data.count / maxCount * 100) : 0;
      return `
        <div class="distribution-item">
          <div style="flex: 1;">
            <div class="distribution-label">${escapeHtml(name)}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
              ${data.count}幅 · ${data.pieces}片 · ${formatTime(data.time)}
            </div>
            <div class="distribution-bar-container">
              <div class="distribution-bar" style="width: ${percentage}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // 日历相关变量
  let currentCalendarYear = new Date().getFullYear();
  let currentCalendarMonth = new Date().getMonth();
  
  // 获取某天的拼图时间（毫秒）
  async function getDailyPuzzleTime(date) {
    const dateStr = date.toISOString().split('T')[0];
    const puzzles = await getPuzzles();
    
    let totalTime = 0;
    puzzles.forEach(puzzle => {
      if (puzzle.sessions) {
        puzzle.sessions.forEach(session => {
          const sessionDate = new Date(session.startTime).toISOString().split('T')[0];
          if (sessionDate === dateStr) {
            totalTime += session.duration || 0;
          }
        });
      }
    });
    
    return totalTime;
  }
  
  // 获取某月所有天的拼图时间
  async function getMonthlyPuzzleData(year, month) {
    const data = {};
    const puzzles = await getPuzzles();
    
    puzzles.forEach(puzzle => {
      if (puzzle.sessions) {
        puzzle.sessions.forEach(session => {
          const sessionDate = new Date(session.startTime);
          const sessionYear = sessionDate.getFullYear();
          const sessionMonth = sessionDate.getMonth();
          
          if (sessionYear === year && sessionMonth === month) {
            const dateStr = sessionDate.toISOString().split('T')[0];
            if (!data[dateStr]) {
              data[dateStr] = 0;
            }
            data[dateStr] += session.duration || 0;
          }
        });
      }
    });
    
    return data;
  }
  
  // 获取时间等级（0-4）
  function getTimeLevel(milliseconds) {
    const minutes = milliseconds / 60000;
    if (minutes === 0) return 0;
    if (minutes < 30) return 1;
    if (minutes < 60) return 2;
    if (minutes < 120) return 3;
    return 4;
  }
  
  // 渲染日历
  async function renderCalendar(year, month) {
    const monthlyData = await getMonthlyPuzzleData(year, month);
    const grid = document.getElementById('calendar-grid');
    const monthYear = document.getElementById('calendar-month-year');
    const periodBadge = document.getElementById('calendar-current-period');
    
    // 更新年月显示
    const periodText = `${year}年${month + 1}月`;
    monthYear.textContent = periodText;
    if (periodBadge) {
      periodBadge.textContent = periodText;
    }
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const firstDayOfWeek = firstDay.getDay(); // 0-6
    const totalDays = lastDay.getDate();
    
    let html = '';
    
    // 填充上月空白
    for (let i = 0; i < firstDayOfWeek; i++) {
      html += '<div class="calendar-day empty"></div>';
    }
    
    // 填充当月日期
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const dateStr = date.toISOString().split('T')[0];
      const time = monthlyData[dateStr] || 0;
      const level = getTimeLevel(time);
      
      let classes = `calendar-day level-${level}`;
      if (dateStr === todayStr) {
        classes += ' today';
      }
      
      const tooltipText = time > 0 ? `${formatTime(time)}` : '无拼图记录';
      
      html += `
        <div class="${classes}" title="${escapeHtml(tooltipText)}">
          ${day}
          <div class="calendar-tooltip">${escapeHtml(tooltipText)}</div>
        </div>
      `;
    }
    
    grid.innerHTML = html;
  }
  
  // 日历导航
  async function prevMonth() {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    await renderCalendar(currentCalendarYear, currentCalendarMonth);
  }
  
  async function nextMonth() {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    await renderCalendar(currentCalendarYear, currentCalendarMonth);
  }
  
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
