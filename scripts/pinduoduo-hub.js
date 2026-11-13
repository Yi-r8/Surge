// 拼多多首页精简（小慧 fork，2026-11-13）
// 来源：RuCu6 pinduoduo.js（2026-09-26）的 /api/alexa/homepage/hub 分支，原样保留，
// 仅启用被注释掉的 delete icon_set（删首页图标行）。评价页/取件页分支不在此文件，
// 仍由 RuCu6 原脚本处理。
// 改用脚本而不用 Body Rewrite jq：v3 的 hub jq 规则已确认加载但图标行仍在，
// 而脚本改写是本接口上实测有效的路径（底栏过滤即由此生效）。

const url = $request.url;
if (!$response.body) $done({});
let body = $response.body;

if (url.includes("/api/alexa/homepage/hub")) {
  let obj = JSON.parse(body);
  // 底部标签栏
  if (obj?.result) {
    if (obj?.result?.bottom_tabs?.length > 0) {
      // 标签栏1
      obj.result.bottom_tabs = obj.result.bottom_tabs.filter((i) => /(?:chat_list|index|personal)/.test(i?.link));
    }
    if (obj?.result?.buffer_bottom_tabs?.length > 0) {
      // 标签栏2
      obj.result.buffer_bottom_tabs = obj.result.buffer_bottom_tabs.filter((i) => /(?:chat_list|index|personal)/.test(i?.link));
    }
    if (obj?.result?.dy_module?.irregular_banner_dy) {
      delete obj.result.dy_module.irregular_banner_dy; // 首页 顶部banner
    }
    delete obj.result.icon_set; // 顶部图标行（限时秒杀/充值中心/现金大转盘/免费领水果/其他）
    if (obj?.result?.search_bar_hot_query) {
      delete obj.result.search_bar_hot_query; // 搜索框填充词
    }
    if (obj?.result?.top_skin) {
      delete obj.result.top_skin; // 首页 顶部背景图
    }
  }
  body = JSON.stringify(obj);
} else {
  $done({});
}

$done({ body });
