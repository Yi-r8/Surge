// Surge 拼多多精简脚本（首页 + 底栏 + 评价/取件）
const url = $request.url;
if (!$response.body) $done({});
let body = $response.body;

// ---------- 底栏：只要 首页 / 聊天 / 个人中心 ----------
const KEEP_TAB = [
  /首页/, /^home$/i, /index/i, /main_?page/i,
  /聊天/, /消息/, /chat/i, /message/i,
  /个人/, /我的/, /personal/i, /^mine$/i, /user_?center/i,
];

// ---------- 首页顶部图标：只留工具类 ----------
const KEEP_ICON = [/秒杀/, /充值/, /9块9/, /九块九/, /资质/, /规则/];

// ---------- 首页模块：整块下掉广告位 ----------
const DEAD_MODULE = {
  irregular_banner_dy: 1, irregular_banner: 1,
  ad_module: 1, community_goods: 1, jiyun_entrance: 1,
  recommend_fresh_info: 1, recommend_fresh_info_lite: 1,
  billion_subsidy_entrance: 1, billion_subsidy_entrance_dy: 1, billion_subsidy_entrance_lite: 1,
  new_user_zone: 1, new_user_zone_dy: 1, new_user_zone_v2: 1,
};

const DEAD_DY = ["recommend_fresh_info", "billion_subsidy_entrance_dy"];

function stringsOf(v, depth) {
  const out = [];
  const walk = (x, d) => {
    if (d > 4 || x == null) return;
    if (typeof x === "string") { out.push(x); return; }
    if (typeof x === "number") { out.push(String(x)); return; }
    if (Array.isArray(x)) { for (const i of x) walk(i, d + 1); return; }
    if (typeof x === "object") { for (const k of Object.keys(x)) walk(x[k], d + 1); }
  };
  walk(v, depth || 0);
  return out;
}

// 空 link 的是 App 原生页签（首页/聊天/个人中心），必须保留；
// 有 link 的是服务端注入的推广页签（多多视频、分类/11.11），不匹配白名单就删。
function keepTab(tab) {
  if (!tab || typeof tab !== "object") return false;
  const link = tab.link === undefined ? tab.link_url : tab.link;
  if (link === undefined || link === null || String(link).trim() === "") return true;
  const texts = stringsOf(tab);
  return KEEP_TAB.some((re) => texts.some((t) => re.test(t)));
}

function filterList(list, keep, label) {
  if (!Array.isArray(list) || !list.length) return list;
  const kept = list.filter(keep);
  if (kept.length !== list.length) {
    console.log(label + ": " + list.length + " -> " + kept.length);
  }
  return kept;
}

// ---------- 首页商品流：只摘掉广告位，保留自然结果 ----------
const AD_KEYS = ["is_ad", "ad", "ad_info", "ad_type", "ad_extra", "click_track_info", "sponsor_info"];
const AD_TYPE_WHITELIST = [0, "0"];

function isAdCell(cell) {
  if (!cell || typeof cell !== "object") return false;
  const t = cell.type;
  if (t !== undefined && AD_TYPE_WHITELIST.indexOf(t) < 0) return true;   // 非商品卡片
  const g = cell.data || {};
  if (!g.goods_id) return true;                                           // 没有商品 id 的一律丢弃
  if (g.need_ad_logo) return true;
  for (let i = 0; i < AD_KEYS.length; i++) {
    const v = g[AD_KEYS[i]];
    if (v && !(typeof v === "object" && Object.keys(v).length === 0)) return true;
  }
  const tags = g.tag_list || [];
  for (let i = 0; i < tags.length; i++) {
    const txt = String(tags[i] && (tags[i].text || tags[i].title) || "");
    if (txt.indexOf("广告") >= 0 || txt.indexOf("推广") >= 0) return true;
  }
  return false;
}

if (url.indexOf("/api/alexa/cells/hub") >= 0) {
  try {
    const obj = JSON.parse(body);
    const list = obj && obj.data && obj.data.goods_list;
    if (Array.isArray(list) && list.length) {
      const kept = list.filter((c) => !isAdCell(c));
      const dropped = list.length - kept.length;
      if (dropped > 0) {
        obj.data.goods_list = kept;
        console.log("feed: " + list.length + " -> " + kept.length + " (drop " + dropped + ")");
      } else {
        console.log("feed: " + list.length + " cells, no ad cell");
      }
    }
    body = JSON.stringify(obj);
  } catch (e) {
    console.log("feed parse failed: " + e);
  }
  $done({ body });
} else if (url.includes("/api/alexa/homepage/hub")) {
  try {
    const obj = JSON.parse(body);
    const res = obj && obj.result;
    if (res) {
      // 底栏
      if (res.bottom_tabs) res.bottom_tabs = filterList(res.bottom_tabs, keepTab, "bottom_tabs");
      if (res.buffer_bottom_tabs) res.buffer_bottom_tabs = filterList(res.buffer_bottom_tabs, keepTab, "buffer_bottom_tabs");
      // 顶部图标
      if (Array.isArray(res.icon_set) && res.icon_set.length) {
        const icons = res.icon_set.filter((i) => KEEP_ICON.some((re) => re.test(String(i && i.title || ""))));
        if (icons.length) res.icon_set = icons;
        else delete res.icon_set;
        console.log("icon_set -> " + (res.icon_set ? res.icon_set.length : 0));
      }
      // 模块顺序表：去掉广告区块
      if (Array.isArray(res.module_order)) {
        const before = res.module_order.length;
        res.module_order = res.module_order.filter((m) => !DEAD_MODULE[String(m && m.module_name || "")]);
        console.log("module_order: " + before + " -> " + res.module_order.length);
      }
      // 动态模块
      if (res.dy_module && typeof res.dy_module === "object") {
        for (const k of DEAD_DY) delete res.dy_module[k];
        if (!Object.keys(res.dy_module).length) delete res.dy_module;
      }
      // 其余顶部装扮 / 热词
      if (res.search_bar_hot_query) delete res.search_bar_hot_query;
      if (res.top_skin) delete res.top_skin;
      if (res.home_screen_skin) delete res.home_screen_skin;
      if (res.banner_list) delete res.banner_list;
    }
    body = JSON.stringify(obj);
  } catch (e) {
    console.log("hub parse failed: " + e);
  }
  $done({ body });
} else if (url.includes("/api/oak/integration/render") || url.includes("/api/philo/personal/hub")) {
  try {
    const obj = JSON.parse(body);
    const res = obj && obj.result;
    if (res) {
      for (const key of ["bottom_section_list", "ui.bottom_section", "ui.live_section.float_info",
                         "monthly_card_entrance", "personal_banner", "personal_center_style_v2_vo",
                         "icon_set.icons", "icon_set.top_personal_icons", "title_bar_items"]) {
        const parts = key.split(".");
        let target = res;
        for (let i = 0; i < parts.length - 1 && target; i++) target = target[parts[i]];
        if (target && typeof target === "object") delete target[parts[parts.length - 1]];
      }
    }
    body = JSON.stringify(obj);
  } catch (e) {}
  $done({ body });
} else if (url.includes("/search")) {
  try {
    const obj = JSON.parse(body);
    if (obj && obj.result && obj.result.expansion) delete obj.result.expansion;
    body = JSON.stringify(obj);
  } catch (e) {}
  $done({ body });
} else if (url.includes("/comment_result") || url.includes("/mdkd/package")) {
  if (/^\s*<!DOCTYPE html>/i.test(body)) {
    const css = url.includes("/comment_result")
      ? `#recommend-wrapper,#downloader-container{display:none!important;height:0!important;overflow:hidden!important;}`
      : `#goods-list-big-container,[class^="index_goods-list-big-container"],.goods-list-container,[class^="index_gif-container"],[class^="index_recently-package-container"]{display:none!important;height:0!important;overflow:hidden!important;}`;
    body = body.replace("</head>", `<style>${css}</style></head>`);
    if (body.includes('"has_more":true')) body = body.replace('"has_more":true', '"has_more":false');
  }
  $done({ body });
} else {
  $done({});
}