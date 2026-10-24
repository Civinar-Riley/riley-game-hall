(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))o(r);new MutationObserver(r=>{for(const c of r)if(c.type==="childList")for(const i of c.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&o(i)}).observe(document,{childList:!0,subtree:!0});function n(r){const c={};return r.integrity&&(c.integrity=r.integrity),r.referrerPolicy&&(c.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?c.credentials="include":r.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function o(r){if(r.ep)return;r.ep=!0;const c=n(r);fetch(r.href,c)}})();const y=1024*1024;function h(e){return"gameHall_sv_"+String(e).toLowerCase().replace(/[^a-z0-9._-]+/g,"_")}function w(e){if(!e||typeof e!="object"||e.__opgSave!==1||typeof e.file!="string"||!e.file||!e.data||typeof e.data!="object"||Array.isArray(e.data))return null;let t=0;for(const n of Object.keys(e.data)){if(typeof e.data[n]!="string")return null;t+=n.length+e.data[n].length}return t>y?null:{file:e.file,data:e.data}}function S(e,t){return`<script>(function(){
  var FILE=${JSON.stringify(e).replace(/</g,"\\u003c")};
  var m=${t.replace(/</g,"\\u003c")};
  function post(){try{parent.postMessage({__opgSave:1,file:FILE,data:m},'*')}catch(e){}}
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
})();<\/script>`}const k=`/* ============================================================\r
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
`,x={"blackjack.html":"#f5c542","horse-racing.html":"#f5c542","zhajinhua.html":"#f5c542","minesweeper.html":"#8b9cf0","match-pairs.html":"#2fd6a3","hextris.html":"#5aa9ff","blockrain.html":"#39c5cf"},f=[{file:"blackjack.html",icon:"🃏",name:"21 点 - 黑杰克",desc:"经典黑杰克：下注、要牌、加倍、分牌，40 个成就等你解锁"},{file:"minesweeper.html",icon:"💣",name:"扫雷",desc:"经典扫雷：扫开所有安全格，别踩到雷"},{file:"horse-racing.html",icon:"🏇",name:"赛马场",desc:"赛马竞速：看准马儿下注，体验一把赌马"},{file:"match-pairs.html",icon:"🀄",name:"连连看",desc:"连连看消消乐：把相同的牌全部配对消除"},{file:"zhajinhua.html",icon:"🃏",name:"炸金花",desc:"经典炸金花：3 张牌比大小，3 个 AI 陪你唬人"},{file:"hextris.html",icon:"⬡",name:"六边形消消乐",desc:"Hextris 开源移植：旋转六边形接住落块，三连同色消除"},{file:"blockrain.html",icon:"🧱",name:"俄罗斯方块",desc:"Blockrain 开源移植：经典七种方块消行得分，普通/友好/刁钻三种 AI 难度"}],a=(e,t)=>document.querySelector(e),L=(e,t)=>Array.from(document.querySelectorAll(e));function m(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let l=null;const p=new Set;function $(e){try{return JSON.parse(localStorage.getItem(h(e))||"{}")||{}}catch{return{}}}function E(e,t){try{localStorage.setItem(h(e),JSON.stringify(t))}catch{}}let b=null,s=null;function u(){s&&(Object.keys(s).forEach(e=>E(e,s[e])),s=null)}window.addEventListener("pagehide",u);window.addEventListener("message",e=>{if(!p.has(e.source))return;const t=w(e.data);t&&(s=s||{},s[t.file]=t.data,clearTimeout(b),b=setTimeout(u,300))});function O(e,t){const n=S(t,JSON.stringify($(t))),o=x[t]||"#f5c542",r=`<style>${k}:root{--t-accent:${o};}</style>`;let c=/<head[^>]*>/i.test(e)?e.replace(/<head[^>]*>/i,i=>i+n+r):n+r+e;return c=c.replace(/<body([^>]*)>/i,(i,g)=>/class\s*=/i.test(g)?i.replace(/class\s*=\s*["']([^"']*)["']/i,'class="$1 hall-theme"'):`<body${g} class="hall-theme">`),c}function v(){a("#viewWall").classList.remove("view-hidden"),a("#viewPlayer").classList.add("view-hidden"),document.title="🎮 游戏厅"}function j(){u(),l=null;const e=a("#gameFrame");p.delete(e.contentWindow),e.removeAttribute("srcdoc"),v()}async function d(e){const t=f[e];if(!t)return;u(),l=e,L(".game-card").forEach((o,r)=>o.classList.toggle("active",r===e)),a("#playerTitle").textContent=`${t.icon} ${t.name}`,a("#viewWall").classList.add("view-hidden"),a("#viewPlayer").classList.remove("view-hidden"),document.title=`${t.icon} ${t.name} - 游戏厅`;const n=a("#gameFrame");a("#playerTip").textContent="🎮 加载中…";try{const o=await fetch(`games/${t.file}?b=202610241331`);if(!o.ok)throw new Error(`HTTP ${o.status}`);const r=await o.text();p.add(n.contentWindow),n.srcdoc=O(r,t.file),a("#playerTip").textContent="游戏在独立沙箱中运行，存档自动保存（刷新不丢）"}catch(o){a("#playerTip").textContent=`⚠️ 游戏加载失败：${m(o.message)}`}}function I(){const e=a("#gamesWall");e.innerHTML=f.map((t,n)=>`
        <div class="game-card" data-i="${n}" role="button" tabindex="0">
            <span class="g-icon">${t.icon}</span>
            <div class="g-name">${m(t.name)}</div>
            <div class="g-desc">${m(t.desc)}</div>
            <span class="g-play">▶ 开始游戏</span>
        </div>`).join(""),e.addEventListener("click",t=>{const n=t.target.closest(".game-card");n&&d(+n.dataset.i)}),e.addEventListener("keydown",t=>{if(t.key!=="Enter"&&t.key!==" ")return;const n=t.target.closest(".game-card");n&&d(+n.dataset.i)}),a("#btnBack").addEventListener("click",j),a("#btnReload").addEventListener("click",()=>{l!=null&&d(l)}),a("#btnFull").addEventListener("click",()=>{const t=a("#gameFrame");document.fullscreenElement?document.exitFullscreen():t.requestFullscreen&&t.requestFullscreen()}),a("#btnClearSave").addEventListener("click",()=>{if(l==null)return;const t=f[l];if(confirm(`确定清空「${t.name}」的存档吗？`)){try{localStorage.removeItem(h(t.file))}catch{}d(l)}}),v(),console.log("🎮 游戏厅已加载，共",f.length,"个游戏")}I();
