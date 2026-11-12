// Surge 内存面板脚本（type=generic，供 [Panel] 调用）
// 单个面板，一条进度条显示两种占用，全部用同尺寸的彩色方块：
//   🟩 绿色方块 = 当前占用
//   🟥 红色方块 = 从当前值延伸到峰值的那一段
//   ⬜ 白色方块 = 未用部分
// 注意：不要用 █▓░ 这类方块字符——iOS 字体下 ░ 会渲染成带缝的
// 小格子，和实心条拼在一起很违和；emoji 方块尺寸统一且自带颜色。
// 峰值用 $persistentStore 持久化，检测到引擎重启（uptime 变小）自动重置。
// 数据源：$httpAPI 调 /v1/metrics（Prometheus 纯文本）；
// 若拿不到，再调 /v1/mcp 的 dump_runtime_data（JSON）。
var LIMIT_MB = 50; // iOS Network Extension 内存上限约 50 MB
var PEAK_KEY = "surge-memory-peak-v1";
var BAR_WIDTH = 12;

function fmtUptime(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return sec + " 秒";
  if (sec < 3600) return Math.floor(sec / 60) + " 分钟";
  if (sec < 86400) return (sec / 3600).toFixed(1) + " 小时";
  return (sec / 86400).toFixed(1) + " 天";
}

// 双段进度条：0→当前画 🟩，当前→峰值画 🟥，其余画 ⬜
function dualBar(curPct, peakPct) {
  var cur = Math.round((curPct / 100) * BAR_WIDTH);
  var peak = Math.round((peakPct / 100) * BAR_WIDTH);
  if (cur > BAR_WIDTH) cur = BAR_WIDTH;
  if (peak > BAR_WIDTH) peak = BAR_WIDTH;
  if (cur < 0) cur = 0;
  if (peak < 0) peak = 0;
  var s = "";
  for (var i = 0; i < BAR_WIDTH; i++) {
    if (i < cur) s += "🟩";
    else if (i < peak) s += "🟥";
    else s += "⬜";
  }
  return s;
}

function colorFor(mb) {
  if (mb >= 40) return "#FF3B30"; // 红：接近上限
  if (mb >= 30) return "#FF9500"; // 橙：偏高
  return "#34C759"; // 绿：正常
}

function render(memBytes, uptimeSec, activeReq, dnsCache) {
  var mb = memBytes / 1048576;
  // 峰值跟踪：读出旧峰值，引擎重启则重置
  var peak = mb;
  try {
    var raw = $persistentStore.read(PEAK_KEY);
    if (raw) {
      var obj = JSON.parse(raw);
      var storedUptime = obj.uptime;
      if (
        uptimeSec == null ||
        storedUptime == null ||
        uptimeSec >= storedUptime
      ) {
        peak = Math.max(mb, obj.peak || 0);
      }
    }
  } catch (e) {}
  try {
    $persistentStore.write(
      JSON.stringify({ peak: peak, uptime: uptimeSec }),
      PEAK_KEY
    );
  } catch (e) {}

  var pct = Math.round((mb / LIMIT_MB) * 100);
  var peakPct = Math.round((peak / LIMIT_MB) * 100);
  var lines = [
    "🟩 当前 " + mb.toFixed(1) + " MB (" + pct + "%)",
    "🟥 峰值 " + peak.toFixed(1) + " MB (" + peakPct + "%)",
    dualBar(pct, peakPct),
  ];
  var extra = [];
  if (uptimeSec != null) extra.push("运行 " + fmtUptime(uptimeSec));
  if (activeReq != null) extra.push("请求 " + activeReq);
  if (dnsCache != null) extra.push("DNS " + dnsCache);
  if (extra.length) lines.push(extra.join(" | "));
  $done({
    title: "Surge 内存",
    content: lines.join("\n"),
    icon: "memorychip",
    "icon-color": colorFor(mb),
  });
}

function fail(msg) {
  $done({ title: "Surge 内存", content: "读取失败：" + msg, style: "error" });
}

// 路径 1：/v1/metrics（Prometheus 纯文本）
function tryMetrics() {
  try {
    $httpAPI("GET", "/v1/metrics", null, function (result) {
      var text = null;
      if (typeof result === "string") text = result;
      else if (result && typeof result.body === "string") text = result.body;
      else if (result && typeof result.data === "string") text = result.data;
      if (text) {
        var m = /surge_memory_bytes\s+(\d+)/.exec(text);
        if (m) {
          var up = /surge_uptime_seconds\s+([\d.]+)/.exec(text);
          var ar = /surge_active_requests\s+(\d+)/.exec(text);
          var dc = /surge_dns_cache_entries\s+(\d+)/.exec(text);
          render(
            parseInt(m[1], 10),
            up ? parseFloat(up[1]) : null,
            ar ? parseInt(ar[1], 10) : null,
            dc ? parseInt(dc[1], 10) : null
          );
          return;
        }
      }
      tryMcp();
    });
  } catch (e) {
    tryMcp();
  }
}

// 路径 2：/v1/mcp dump_runtime_data（JSON）
function tryMcp() {
  try {
    $httpAPI(
      "POST",
      "/v1/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "dump_runtime_data", arguments: { type: "performance" } },
      },
      function (result) {
        try {
          var c =
            result && result.result && result.result.content && result.result.content[0];
          var data = c && c.text ? JSON.parse(c.text) : null;
          var mem = data && (data["memory-bytes"] || data.memoryBytes);
          if (mem) {
            render(
              mem,
              data.uptime != null ? data.uptime : null,
              data["active-requests"],
              data["dns-cache-entries"]
            );
          } else {
            fail("无内存数据");
          }
        } catch (e2) {
          fail("解析失败");
        }
      }
    );
  } catch (e) {
    fail("接口不可用");
  }
}

tryMetrics();
