// Surge 拼多多精简脚本（底栏白名单版）
const url = $request.url;
if (!$response.body) $done({});
let body = $response.body;

// 底栏只保留：首页 / 聊天 / 个人中心
const KEEP = [/首页/, /^home$/i, /(?:^|[_.-])index(?:$|[_.-])/i, /main_page/i,
              /聊天/, /消息/, /chat/i, /message/i,
              /个人/, /我的/, /personal/i, /^mine$/i, /user_?center/i];
const DROP = [/多多视频/, /视频/, /video/i, /直播/, /买菜/, /grocery/i,
              /百亿补贴/, /推荐/, /recommend/i, /福利/, /welfare/i];

function fieldsOf(tab) {
  const out = [];
  const walk = (v, depth) => {
    if (depth > 3 || v == null) return;
    if (typeof v === "string") { out.push(v); return; }
    if (typeof v === "number") { out.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === "object") Object.keys(v).forEach((k) => walk(v[k], depth + 1));
  };
  walk(tab, 0);
  return out;
}

function keepTab(tab) {
  const texts = fieldsOf(tab);
  if (KEEP.some((re) => texts.some((t) => re.test(t)))) return true;   // 白名单优先
  return false;                                                        // 其余一律去掉（含 DROP）
}

function filterTabs(list, label) {
  if (!Array.isArray(list) || !list.length) return list;
  const kept = list.filter(keepTab);
  console.log(`${label}: ${list.length} -> ${kept.length} | ` +
    list.map((t) => (fieldsOf(t).find((x) => x.length < 24) || "?")).join(" , "));
  return kept.length ? kept : list;
}

if (url.includes("/api/alexa/homepage/hub")) {
  try {
    const obj = JSON.parse(body);
    const res = obj?.result;
    if (res) {
      if (res.bottom_tabs) res.bottom_tabs = filterTabs(res.bottom_tabs, "bottom_tabs");
      if (res.buffer_bottom_tabs) res.buffer_bottom_tabs = filterTabs(res.buffer_bottom_tabs, "buffer_bottom_tabs");
      if (res.dy_module?.irregular_banner_dy) delete res.dy_module.irregular_banner_dy;
      if (res.search_bar_hot_query) delete res.search_bar_hot_query;
      if (res.top_skin) delete res.top_skin;
    }
    body = JSON.stringify(obj);
  } catch (e) {
    console.log("hub parse failed: " + e);
  }
  $done({ body });
} else if (url.includes("/comment_result") || url.includes("/mdkd/package")) {
  if (/^\s*<!DOCTYPE html>/i.test(body)) {
    const css = url.includes("/comment_result")
      ? `#recommend-wrapper,#downloader-container{display:none!important;height:0!important;overflow:hidden!important;}`
      : `#goods-list-big-container,[class^="index_goods-list-big-container"],.goods-list-container,[class^="index_gif-container"]{display:none!important;height:0!important;overflow:hidden!important;}`;
    body = body.replace("</head>", `<style>${css}</style></head>`);
    if (body.includes('"has_more":true')) body = body.replace('"has_more":true', '"has_more":false');
  }
  $done({ body });
} else {
  $done({});
}