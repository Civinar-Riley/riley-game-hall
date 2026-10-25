/* 存档桥纯函数模块：垫片脚本生成 / 快照消息校验 / 存储键名
 *
 * 沙箱 iframe（无 allow-same-origin）里 localStorage 抛 SecurityError，
 * 垫片用内存对象顶替保证游戏 API 行为不变，同时 postMessage 全量快照给父页落盘；
 * 父页在 playGame 时把已存档数据预注入垫片初始内存，游戏脚本执行前存档已就位（同步读无需跨帧等待）。
 *
 * 纯函数（无 DOM、无 window 依赖），供大厅与回归测试共用。 */

/* 单游戏存档上限：超限拒收（游戏 HTML 通常几 KB～几百 KB，1MB 足够宽裕） */
export const SAVE_LIMIT = 1024 * 1024;

/* 存储键名：一律 gameHall_ 前缀 + 游戏文件名（安全字符白名单，防路径穿越/键冲突） */
export function saveKey(file) {
  return 'gameHall_sv_' + String(file).toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
}

/* 校验 iframe 发来的存档快照消息；坏形态/超限返回 null（父页侧调用）。
 * 快照契约：{__opgSave:1, file:'<游戏文件名>', session:'<会话标识>', data:{<localStorage 键>:<字符串值>}}
 * - file 必须为非空字符串，session 必须为字符串，父页验证来源及当前会话
 * - data 必须为纯对象（键值均为字符串）；全量快照按整对象校验，部分字段坏形态整包拒收
 * - 快照总大小 ≤ SAVE_LIMIT（1MB，游戏 HTML 通常几 KB～几百 KB，足够宽裕） */
export function validateSavePayload(msg) {
  if (!msg || typeof msg !== 'object' || msg.__opgSave !== 1) return null;
  if (typeof msg.file !== 'string' || !msg.file) return null;
  if (typeof msg.session !== 'string') return null;
  if (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)) return null;
  let size = 0;
  for (const k of Object.keys(msg.data)) {
    if (typeof msg.data[k] !== 'string') return null;
    size += k.length + msg.data[k].length;
  }
  if (size > SAVE_LIMIT) return null;
  return { file: msg.file, session: msg.session, data: msg.data };
}

/* 生成注入 iframe 的 localStorage 垫片脚本：
 * - 初始内存 = 已落盘存档（initDataJson，父页注入时已确保为对象）
 * - setItem/removeItem/clear/key/length 全套垫片（与游戏 localStorage 语义一致）
 * - setItem/removeItem/clear 后全量快照 postMessage('{__opgSave:1,file,session,data}') 给父页
 * - pagehide → post（卸载前最终快照）
 * - localStorage 访问本身不抛错也照常垫（try{window.localStorage}catch(e){} →
 *   沙箱 iframe 抛 SecurityError → 捕获 → s=null → defineProperty 内存垫片——
 *   与 build.js 内嵌游戏的生成器 shim 同一惯例） */
export function shimSource(file, initDataJson, session = '') {
  return `<script>(function(){
  var FILE=${JSON.stringify(file).replace(/</g,'\\u003c')};
  var SESSION=${JSON.stringify(session).replace(/</g,'\\u003c')};
  var m=${initDataJson.replace(/</g,'\\u003c')};
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
})();<\/script>`;
}
