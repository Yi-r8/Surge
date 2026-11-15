/**
 * B站大会员解锁 - Surge 适配版
 * 改自 TomCatXue 的 bilibili_vip.js（Loon 版），仅改动参数读取一处：
 * Surge 的 $argument 永远是字符串，这里先 JSON.parse 再取字段；
 * Loon 下 $argument 本来就是对象，原逻辑不变；数组格式也兼容。
 *
 * 来源：https://github.com/TomCatXue/MyCookieCenter (scripts/tools/bilibili/bilibili_vip.js)
 * 上游：https://he2o.vercel.app/Resource/Plugin/Bilibili.js
 * 仅保留会员解锁所需逻辑，去除其他净化/改页面代码
 *
 * 用法（在模块中）：
 *   bilibili.vip = type=http-request,pattern=^...PlayViewUnite|PlayView...,script-path=<本文件>,enabled={{{VIP}}},argument="{"Authorization":"{{{Authorization}}}","UserAgent":"{{{UserAgent}}}"}"
 *
 * Surge 版补充：凭证缺失时静默透传，不弹通知（避免规则常开时每次播放都弹）。
 */

// ============================================================
// http-response（画质/会员状态）模式：仅需透传，不检查参数、不弹通知
// ============================================================
if (typeof $response !== 'undefined') {
    $done({});
    return;
}

// ============================================================
// http-request（播放请求注入 Authorization）模式
// ============================================================
const header = $request.headers;

// Surge 适配：$argument 可能是字符串（JSON 对象/数组）或对象，统一转成对象
let _args = $argument;
if (typeof _args === "string") {
    try { _args = JSON.parse(_args); } catch (e) { _args = {}; }
}
if (Array.isArray(_args)) _args = { Authorization: _args[0], UserAgent: _args[1] };

let authorization = _args?.Authorization;
let userAgent = header["user-agent"];

if (_args?.UserAgent) userAgent = _args.UserAgent;

if (!authorization) {
    // 凭证缺失时静默透传，不弹通知（Surge 版补充，见文件头注释）
    $done({});
    return;
}

header["authorization"] = authorization;
header["user-agent"] = userAgent;

console.log("✅ 哔哩哔哩大会员已解锁 🎉");

$done({ headers: header });
