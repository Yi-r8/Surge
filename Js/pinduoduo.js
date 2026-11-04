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

function keepTab(tab) {
  const texts = stringsOf(tab);
  return KEEP_TAB.some((re) => texts.some((t) => re.test(t)));
}

function filterList(list, keep, label) {
  if (!Array.isArray(list) || !list.length) return list;
  const kept = list.filter(keep);
  if (kept.length && kept.length !== list.length) {
    console.log(label + ": " + list.length + " -> " + kept.length);
    return kept;
  }
  return kept.length ? kept : list;
}

if (url.includes("/api/alexa/homepage/hub")) {
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
