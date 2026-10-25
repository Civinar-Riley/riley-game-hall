/* 游戏厅壳：卡片墙首页 + 沙箱 iframe 播放 + 存档桥
 * 架构：Vite 壳 + public/games/*.html 单文件游戏，运行时 fetch → 注入 localStorage
 * 垫片 → srcdoc 进沙箱 iframe（无 allow-same-origin，游戏读不到壳数据）。
 * 存档桥纯函数来自 src/hall/gamesave.js（用户老项目 game-hall 的 battle-tested 模块）。
 */
import { saveKey, validateSavePayload, shimSource } from './gamesave.js';
import './hall.css';
import themeCss from './game-theme.css?raw';

/* 每游戏主题 accent 色：设计语言统一、各留主题色（v1） */
const ACCENTS = {
    'blackjack.html': '#f5c542',    // 金（赌场）
    'horse-racing.html': '#f5c542', // 金（赌场）
    'zhajinhua.html': '#f5c542',    // 金（赌场）
    'minesweeper.html': '#8b9cf0',  // 紫蓝（保留原风格）
    'match-pairs.html': '#2fd6a3',  // 薄荷绿（保留原风格）
    'hextris.html': '#5aa9ff',      // 雾蓝（原 #2c3e50 系）
    'blockrain.html': '#39c5cf',    // 青（方块主色之一）
};

/* 游戏清单：加游戏 = public/games/ 里丢一个单文件 html + 在这里加一行 */
const GAMES = [
    { file: 'blackjack.html',   icon: '🃏', name: '21 点 - 黑杰克', desc: '经典黑杰克：下注、要牌、加倍、分牌，40 个成就等你解锁' },
    { file: 'minesweeper.html',  icon: '💣', name: '扫雷',           desc: '经典扫雷：扫开所有安全格，别踩到雷' },
    { file: 'horse-racing.html', icon: '🏇', name: '赛马场',         desc: '赛马竞速：看准马儿下注，体验一把赌马' },
    { file: 'match-pairs.html',  icon: '🀄', name: '连连看',         desc: '连连看消消乐：把相同的牌全部配对消除' },
    { file: 'zhajinhua.html',    icon: '🃏', name: '炸金花',         desc: '经典炸金花：3 张牌比大小，3 个 AI 陪你唬人' },
    { file: 'hextris.html',      icon: '⬡', name: '六边形消消乐',   desc: 'Hextris 开源移植：旋转六边形接住落块，三连同色消除' },
    { file: 'blockrain.html',    icon: '🧱', name: '俄罗斯方块',     desc: 'Blockrain 开源移植：经典七种方块消行得分，普通/友好/刁钻三种 AI 难度' },
];

const $ = (s, root) => (root || document).querySelector(s);
const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let curGame = null;
let loadVersion = 0;
const knownFrames = new Map();

/* ---------------- 存档桥 ---------------- */
function readSave(file) {
    try { return JSON.parse(localStorage.getItem(saveKey(file)) || '{}') || {}; }
    catch (e) { return {}; }
}
function writeSave(file, data) {
    try { localStorage.setItem(saveKey(file), JSON.stringify(data)); }
    catch (e) { /* 配额满/隐私模式：静默失败，游戏不崩 */ }
}
let flushT = null, pending = null;
function flushSaves() {
    clearTimeout(flushT);
    flushT = null;
    if (!pending) return;
    Object.keys(pending).forEach(f => writeSave(f, pending[f]));
    pending = null;
}
window.addEventListener('pagehide', flushSaves);

window.addEventListener('message', e => {
    const active = knownFrames.get(e.source);
    if (!active) return;
    const v = validateSavePayload(e.data);
    if (!v || v.file !== active.file || v.session !== active.session) return;
    pending = pending || {};
    pending[v.file] = v.data;
    clearTimeout(flushT);
    flushT = setTimeout(flushSaves, 300);
});

/* 垫片必须先于游戏脚本执行：有 <head> 插其后，否则放最前。
 * 同时注入统一设计语言（game-theme.css）：:root 变量 + 本游戏 accent；
 * 给 body 加 hall-theme 类，让主题基础样式生效。 */
function withShim(html, file, session) {
    const shim = shimSource(file, JSON.stringify(readSave(file)), session);
    const accent = ACCENTS[file] || '#f5c542';
    /* accent 必须写在 themeCss 之后：两者同为 :root 选择器，后者才能覆盖
     * game-theme.css 里的默认 --t-accent（否则所有游戏都被默认金色吞掉） */
    const theme = `<style>${themeCss}:root{--t-accent:${accent};}</style>`;
    let out = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, m => m + shim + theme)
        : shim + theme + html;
    out = out.replace(/<body([^>]*)>/i, (m, attrs) =>
        /class\s*=/i.test(attrs)
            ? m.replace(/class\s*=\s*["']([^"']*)["']/i, 'class="$1 hall-theme"')
            : `<body${attrs} class="hall-theme">`);
    return out;
}

/* ---------------- 首页卡片墙 ---------------- */
function renderWall() {
    $('#viewWall').classList.remove('view-hidden');
    $('#viewPlayer').classList.add('view-hidden');
    document.title = '🎮 游戏厅';
}

function backToWall() {
    ++loadVersion;
    flushSaves();
    curGame = null;
    const frame = $('#gameFrame');
    knownFrames.delete(frame.contentWindow);
    frame.removeAttribute('srcdoc');
    renderWall();
}

/* ---------------- 播放 ---------------- */
async function playGame(i) {
    const g = GAMES[i];
    if (!g) return;
    const version = ++loadVersion;
    flushSaves();
    curGame = i;
    $$('.game-card').forEach((c, k) => c.classList.toggle('active', k === i));
    $('#playerTitle').textContent = `${g.icon} ${g.name}`;
    $('#viewWall').classList.add('view-hidden');
    $('#viewPlayer').classList.remove('view-hidden');
    document.title = `${g.icon} ${g.name} - 游戏厅`;

    const frame = $('#gameFrame');
    $('#playerTip').textContent = '🎮 加载中…';
    try {
        /* 游戏文件名无哈希，拼构建时间戳破缓存，保证每次部署后拿到最新版 */
        const resp = await fetch(`games/${g.file}?b=${__HALL_BUILD__}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        if (version !== loadVersion) return;
        flushSaves();
        const session = String(version);
        const srcdoc = withShim(html, g.file, session);
        // iframe 导航复用 WindowProxy，必须按会话区分旧页面的卸载快照。
        knownFrames.set(frame.contentWindow, { file: g.file, session });
        frame.srcdoc = srcdoc;
        $('#playerTip').textContent = '游戏在独立沙箱中运行，存档自动保存（刷新不丢）';
    } catch (err) {
        if (version !== loadVersion) return;
        $('#playerTip').textContent = `⚠️ 游戏加载失败：${esc(err.message)}`;
    }
}

/* ---------------- 启动 ---------------- */
function init() {
    const wall = $('#gamesWall');
    wall.innerHTML = GAMES.map((g, i) => `
        <div class="game-card" data-i="${i}" role="button" tabindex="0">
            <span class="g-icon">${g.icon}</span>
            <div class="g-name">${esc(g.name)}</div>
            <div class="g-desc">${esc(g.desc)}</div>
            <span class="g-play">▶ 开始游戏</span>
        </div>`).join('');
    wall.addEventListener('click', e => {
        const card = e.target.closest('.game-card');
        if (card) playGame(+card.dataset.i);
    });
    wall.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.game-card');
        if (card) playGame(+card.dataset.i);
    });

    $('#btnBack').addEventListener('click', backToWall);
    $('#btnReload').addEventListener('click', () => { if (curGame != null) playGame(curGame); });
    /* 全屏：直接对 iframe 本体 requestFullscreen（沙箱内容无需特权，Esc 退出为浏览器原生行为）；
     * 不对容器全屏——容器全屏时 iframe 高度仍是 72vh，下方会留黑边（bug） */
    $('#btnFull').addEventListener('click', () => {
        const frame = $('#gameFrame');
        if (document.fullscreenElement) document.exitFullscreen();
        else if (frame.requestFullscreen) frame.requestFullscreen();
    });
    $('#btnClearSave').addEventListener('click', () => {
        if (curGame == null) return;
        const g = GAMES[curGame];
        if (!confirm(`确定清空「${g.name}」的存档吗？`)) return;
        knownFrames.delete($('#gameFrame').contentWindow);
        if (pending) delete pending[g.file];
        try { localStorage.removeItem(saveKey(g.file)); } catch (e) {}
        playGame(curGame);
    });

    renderWall();
    console.log('🎮 游戏厅已加载，共', GAMES.length, '个游戏');
}

init();
