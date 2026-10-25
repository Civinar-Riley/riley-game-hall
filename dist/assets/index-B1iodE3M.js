(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))l(r);new MutationObserver(r=>{for(const a of r)if(a.type==="childList")for(const o of a.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&l(o)}).observe(document,{childList:!0,subtree:!0});function n(r){const a={};return r.integrity&&(a.integrity=r.integrity),r.referrerPolicy&&(a.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?a.credentials="include":r.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function l(r){if(r.ep)return;r.ep=!0;const a=n(r);fetch(r.href,a)}})();const S=1024*1024;function b(e){return"gameHall_sv_"+String(e).toLowerCase().replace(/[^a-z0-9._-]+/g,"_")}function k(e){if(!e||typeof e!="object"||e.__opgSave!==1||typeof e.file!="string"||!e.file||typeof e.session!="string"||!e.data||typeof e.data!="object"||Array.isArray(e.data))return null;let t=0;for(const n of Object.keys(e.data)){if(typeof e.data[n]!="string")return null;t+=n.length+e.data[n].length}return t>S?null:{file:e.file,session:e.session,data:e.data}}function x(e,t,n=""){return`<script>(function(){
  var FILE=${JSON.stringify(e).replace(/</g,"\\u003c")};
  var SESSION=${JSON.stringify(n).replace(/</g,"\\u003c")};
  var m=${t.replace(/</g,"\\u003c")};
  function post(){try{parent.postMessage({__opgSave:1,file:FILE,session:SESSION,data:m},'*')}catch(e){}}
  function shim(){
    return {
      getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},
      setItem:function(k,v){m[String(k)]=String(v);post()},
      removeItem:function(k){delete m[String(k)];post()},
      clear:function(){m={};post()},
      key:function(i){return Object.keys(m)[i]||null},
      get length(){return Object.keys(m).length}
    };
  }
  var s=null;
  try{s=window.localStorage}catch(e){}
  try{
    if(!s){Object.defineProperty(window,'localStorage',{configurable:true,value:shim()});}
    else{
      /* 极少数真 localStorage 可用环境（如非沙箱直开）：仍用垫片接管，保证存档走桥 */
      Object.defineProperty(window,'localStorage',{configurable:true,value:shim()});
    }
  }catch(e){/* defineProperty 失败：保持原样，仅丢持久化不崩游戏 */}
  window.addEventListener('pagehide',post);
})();<\/script>`}const L=`/* ============================================================\r
 * 游戏厅统一设计语言 v1（设计 tokens）\r
 * 由 hall.js 在 withShim 阶段注入每个游戏的 <head>（运行时），\r
 * 单一来源，各游戏 CSS 用 var(--t-*) 引用。--t-accent 按游戏注入。\r
 * 约定：只统一"框架层"（背景/标题/按钮/卡片/弹窗），玩法画布、\r
 * 棋盘、功能色（扫雷数字/马匹颜色/方块颜色）一律不动。\r
 * ============================================================ */\r
:root {\r
  --t-bg: #0c1411;            /* 主背景：深绿黑 */\r
  --t-bg2: #0f1814;           /* 次级背景 */\r
  --t-card: #15211b;          /* 卡片底 */\r
  --t-card2: #1c2c23;         /* 卡片悬浮 / 次级卡片 */\r
  --t-line: rgba(245, 197, 66, 0.16);  /* 描边（随 accent 微调透明度即可） */\r
  --t-text: #f2f0e4;         /* 主文字 */\r
  --t-muted: #93a89b;         /* 次级文字 */\r
  --t-gold: #f5c542;          /* 品牌金（主按钮/强调） */\r
  --t-accent: #f5c542;        /* 每游戏主题色：运行时按文件注入覆盖 */\r
  --t-danger: #e5484d;\r
  --t-success: #35c46f;\r
  --t-info: #5aa9ff;\r
  --t-radius: 14px;\r
  --t-radius-s: 10px;\r
  --t-font: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",\r
            system-ui, -apple-system, "Segoe UI", sans-serif;\r
  --t-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);\r
  --t-btn-bg: var(--t-accent);\r
  --t-btn-text: #1a1405;\r
}\r
\r
/* 基础：背景/文字用 :where() 零特异度——游戏自带 body 背景（如炸金花的渐变）优先，\r
 * 没写的才回退到主题底；字体用 body.hall-theme 统一覆盖 */\r
:where(body.hall-theme) {\r
  background: var(--t-bg);\r
  color: var(--t-text);\r
}\r
body.hall-theme {\r
  font-family: var(--t-font);\r
  -webkit-tap-highlight-color: transparent;\r
}\r
body.hall-theme button { font-family: inherit; }\r
\r
/* 通用主按钮（游戏可直接套用 class="t-btn"，或照抄这套声明） */\r
.t-btn {\r
  display: inline-flex; align-items: center; justify-content: center;\r
  gap: 6px; padding: 12px 28px; border: none; border-radius: 999px;\r
  background: var(--t-btn-bg); color: var(--t-btn-text);\r
  font-size: 16px; font-weight: 700; cursor: pointer;\r
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);\r
  transition: transform 0.12s ease, filter 0.12s ease;\r
}\r
.t-btn:active { transform: scale(0.96); filter: brightness(1.08); }\r
.t-btn.ghost {\r
  background: transparent; color: var(--t-text);\r
  border: 1px solid var(--t-line);\r
}\r
.t-btn.danger { background: var(--t-danger); color: #fff; }\r
\r
/* 通用标题 */\r
.t-title {\r
  color: var(--t-text); font-weight: 800; letter-spacing: 1px;\r
}\r
.t-title .t-accent, .t-accent { color: var(--t-accent); }\r
.t-muted { color: var(--t-muted); }\r
\r
/* 通用卡片 */\r
.t-card {\r
  background: var(--t-card); border: 1px solid var(--t-line);\r
  border-radius: var(--t-radius); box-shadow: var(--t-shadow);\r
}\r
`,$={"blackjack.html":"#f5c542","horse-racing.html":"#f5c542","zhajinhua.html":"#f5c542","minesweeper.html":"#8b9cf0","match-pairs.html":"#2fd6a3","hextris.html":"#5aa9ff","blockrain.html":"#39c5cf","suika.html":"#648b45"},m=[{file:"blackjack.html",icon:"🃏",name:"21 点 - 黑杰克",desc:"经典黑杰克：下注、要牌、加倍、分牌，40 个成就等你解锁"},{file:"minesweeper.html",icon:"💣",name:"扫雷",desc:"经典扫雷：扫开所有安全格，别踩到雷"},{file:"horse-racing.html",icon:"🏇",name:"赛马场",desc:"赛马竞速：看准马儿下注，体验一把赌马"},{file:"match-pairs.html",icon:"🀄",name:"连连看",desc:"连连看消消乐：把相同的牌全部配对消除"},{file:"zhajinhua.html",icon:"🃏",name:"炸金花",desc:"经典炸金花：3 张牌比大小，3 个 AI 陪你唬人"},{file:"hextris.html",icon:"⬡",name:"六边形消消乐",desc:"Hextris 开源移植：旋转六边形接住落块，三连同色消除"},{file:"blockrain.html",icon:"🧱",name:"俄罗斯方块",desc:"Blockrain 开源移植：经典七种方块消行得分，普通/友好/刁钻三种 AI 难度"},{file:"suika.html",icon:"🍉",name:"合成大西瓜",desc:"果日小铺：立体水果碰一碰，经典冲分 / 西瓜收集双模式，随时接着玩"}],i=(e,t)=>document.querySelector(e),E=(e,t)=>Array.from(document.querySelectorAll(e));function v(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let s=null,h=0;const g=new Map;function O(e){try{return JSON.parse(localStorage.getItem(b(e))||"{}")||{}}catch{return{}}}function j(e,t){try{localStorage.setItem(b(e),JSON.stringify(t))}catch{}}let p=null,c=null;function f(){clearTimeout(p),p=null,c&&(Object.keys(c).forEach(e=>j(e,c[e])),c=null)}window.addEventListener("pagehide",f);window.addEventListener("message",e=>{const t=g.get(e.source);if(!t)return;const n=k(e.data);!n||n.file!==t.file||n.session!==t.session||(c=c||{},c[n.file]=n.data,clearTimeout(p),p=setTimeout(f,300))});function I(e,t,n){const l=x(t,JSON.stringify(O(t)),n),r=$[t]||"#f5c542",a=`<style>${L}:root{--t-accent:${r};}</style>`;let o=/<head[^>]*>/i.test(e)?e.replace(/<head[^>]*>/i,d=>d+l+a):l+a+e;return o=o.replace(/<body([^>]*)>/i,(d,y)=>/class\s*=/i.test(y)?d.replace(/class\s*=\s*["']([^"']*)["']/i,'class="$1 hall-theme"'):`<body${y} class="hall-theme">`),o}function w(){i("#viewWall").classList.remove("view-hidden"),i("#viewPlayer").classList.add("view-hidden"),document.title="🎮 游戏厅"}function T(){++h,f(),s=null;const e=i("#gameFrame");g.delete(e.contentWindow),e.removeAttribute("srcdoc"),w()}async function u(e){const t=m[e];if(!t)return;const n=++h;f(),s=e,E(".game-card").forEach((r,a)=>r.classList.toggle("active",a===e)),i("#playerTitle").textContent=`${t.icon} ${t.name}`,i("#viewWall").classList.add("view-hidden"),i("#viewPlayer").classList.remove("view-hidden"),document.title=`${t.icon} ${t.name} - 游戏厅`;const l=i("#gameFrame");i("#playerTip").textContent="🎮 加载中…";try{const r=await fetch(`games/${t.file}?b=202610250805`);if(!r.ok)throw new Error(`HTTP ${r.status}`);const a=await r.text();if(n!==h)return;f();const o=String(n),d=I(a,t.file,o);g.set(l.contentWindow,{file:t.file,session:o}),l.srcdoc=d,i("#playerTip").textContent="游戏在独立沙箱中运行，存档自动保存（刷新不丢）"}catch(r){if(n!==h)return;i("#playerTip").textContent=`⚠️ 游戏加载失败：${v(r.message)}`}}function F(){const e=i("#gamesWall");e.innerHTML=m.map((t,n)=>`
        <div class="game-card" data-i="${n}" role="button" tabindex="0">
            <span class="g-icon">${t.icon}</span>
            <div class="g-name">${v(t.name)}</div>
            <div class="g-desc">${v(t.desc)}</div>
            <span class="g-play">▶ 开始游戏</span>
        </div>`).join(""),e.addEventListener("click",t=>{const n=t.target.closest(".game-card");n&&u(+n.dataset.i)}),e.addEventListener("keydown",t=>{if(t.key!=="Enter"&&t.key!==" ")return;const n=t.target.closest(".game-card");n&&u(+n.dataset.i)}),i("#btnBack").addEventListener("click",T),i("#btnReload").addEventListener("click",()=>{s!=null&&u(s)}),i("#btnFull").addEventListener("click",()=>{const t=i("#gameFrame");document.fullscreenElement?document.exitFullscreen():t.requestFullscreen&&t.requestFullscreen()}),i("#btnClearSave").addEventListener("click",()=>{if(s==null)return;const t=m[s];if(confirm(`确定清空「${t.name}」的存档吗？`)){g.delete(i("#gameFrame").contentWindow),c&&delete c[t.file];try{localStorage.removeItem(b(t.file))}catch{}u(s)}}),w(),console.log("🎮 游戏厅已加载，共",m.length,"个游戏")}F();
