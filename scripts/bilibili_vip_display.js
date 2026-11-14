// 会员显示注入：仅提取自 XiaoMan/wuyra 修改版 bilibili.json.js
// （引用修改自 kokoryh/Sparkle bilibili.json.js，2026-08-10；bili-status-code 校验跟进上游 e94110a1）
// 在 mine/myinfo 接口注入百年大会员显示信息（仅本地 UI 显示，不含任何凭证、不改画质）
// 由模块参数 VIP 开关控制（规则 enabled={VIP}）；整条 json 脚本的其余处理（tab/推荐流/直播间）
// 已由 TomCatXue 的 jq 规则与分区脚本覆盖，故不搬运，避免重复处理同一接口。
(() => {
  try {
    const headers = $response.headers;
    const statusCode = headers && (headers["bili-status-code"] || headers["Bili-Status-Code"]);
    if (statusCode !== undefined && String(statusCode) !== "0") return $done({});
    const obj = JSON.parse($response.body);
    if (!obj || !obj.data) return $done({});
    if ($request.url.includes("/account/mine")) {
      delete obj.data.vip_section;
      delete obj.data.vip_section_v2;
      delete obj.data.modular_vip_section;
      obj.data.vip_type = 2;
    }
    obj.data.vip = vipInfo();
    $done({ body: JSON.stringify(obj) });
  } catch (e) {
    console.log(e.toString());
    $done({});
  }

  function vipInfo() {
    const img = vipIcon();
    return {
      status: 1,
      type: 2,
      vip_pay_type: 0,
      due_date: 90052704e5,
      tv_vip_status: 1,
      tv_vip_pay_type: 0,
      tv_due_date: 90052704e5,
      role: 15,
      theme_type: 0,
      nickname_color: "#FB7299",
      avatar_subscript: 1,
      avatar_subscript_url: "",
      avatar_icon: { icon_resource: {} },
      label: {
        path: "",
        text: "百年大会员",
        label_theme: "hundred_annual_vip",
        text_color: "#FFFFFF",
        bg_style: 1,
        bg_color: "#FB7299",
        border_color: "",
        use_img_label: true,
        image: img,
        img_label_uri_hans: "",
        img_label_uri_hant: "",
        img_label_uri_hans_static: img,
        img_label_uri_hant_static: img
      }
    };
  }

  function vipIcon() {
    const now = new Date(), m = now.getMonth() + 1, d = now.getDate();
    if (m === 6 && d === 1) {
      // 儿童节专属图标
      return "https://i0.hdslb.com/bfs/bangumi/kt/d2d09af98bd5aaead93493df9a20a73b474672f7.png";
    }
    return "https://i0.hdslb.com/bfs/vip/52f60c8bdae8d4440edbb96dad72916022adf126.png";
  }
})();
