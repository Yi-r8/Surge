// Surge 内存面板脚本（type=generic，供 [Panel] 调用）
// 两个面板共用这一个脚本，按 $input.panelName 分流：
//   “Surge 内存”——经典面板：一条进度条显示当前/峰值占用。
//   “Surge 内存详情”——详情面板：同一条进度条 + 占用构成的条数明细
//   （DNS 缓存、虚拟 IP、活动请求、临时规则、封禁）。
// 注意：Surge 只报内存总占用，不报各部分的 MB 明细，所以详情面板
// 只能显示各部分的条数/个数，各占多少 MB 是拿不到的，不要硬编。
// 单个面板，一条进度条显示两种占用，全部用统一的横线条形字符：
//   ▬ 粗横条 = 当前占用
//   ┅ 细虚线 = 从当前值延伸到峰值的那一段
//   ─ 细实线 = 未用部分
// 注意：█▓░ 在 iOS 字体下 ░ 会渲染成带缝小格子、和实心条拼着违和；
// emoji 方块用户觉得不好看。制表横线字符能无缝连成一条线，形状统一。
// 峰值用 $persistentStore 持久化，检测到引擎重启（uptime 变小）自动重置。
// 数据源：$httpAPI 调 /v1/metrics（Prometheus 纯文本）；
// 若拿不到，再调 /v1/mcp 的 dump_runtime_data（JSON）。
var LIMIT_MB = 50; // iOS Network Extension 内存上限约 50 MB
var PEAK_KEY = "surge-memory-peak-v1";
var BAR_WIDTH = 16;

function fmtUptime(sec) {
  sec = Math.floor(sec);
  if (sec < 60) return sec + " 秒";
  if (sec < 3600) return Math.floor(sec / 60) + " 分钟";
  if (sec < 86400) return (sec / 3600).toFixed(1) + " 小时";
  return (sec / 86400).toFixed(1) + " 天";
}

// 双段进度条：直接用原始占用比例算格数，不要先把百分比四舍五入
// 成整数再算——两次取整会把峰值和当前的差距吃掉（比如 23.3 和
// 23.7 都变成 47%，虚线段就画不出来了）。
// 0→当前画 ▬（粗横条），当前→峰值画 ┅（细虚线，半透明感），
// 其余画 ─（细实线轨道）；峰值高于当前时至少留一格虚线段，
// 保证差距可见。
function dualBar(curFrac, peakFrac, curMB, peakMB) {
  var cur = Math.round(curFrac * BAR_WIDTH);
  var peak = Math.round(peakFrac * BAR_WIDTH);
  if (cur > BAR_WIDTH) cur = BAR_WIDTH;
  if (peak > BAR_WIDTH) peak = BAR_WIDTH;
  if (cur < 0) cur = 0;
  if (peak < 0) peak = 0;
  if (peak < cur) peak = cur;
  if (peakMB > curMB && peak === cur && peak < BAR_WIDTH) peak = cur + 1;
  var s = "";
  for (var i = 0; i < BAR_WIDTH; i++) {
    if (i < cur) s += "▬";
    else if (i < peak) s += "┅";
    else s += "─";
  }
  return s;
}

function colorFor(mb) {
  if (mb >= 40) return "#FF3B30"; // 红：接近上限
  if (mb >= 30) return "#FF9500"; // 橙：偏高
  return "#34C759"; // 绿：正常
}

function trackPeak(mb, uptimeSec) {
  // 峰值跟踪：读出旧峰值，引擎重启则重置；两个面板共用同一个 key。
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
  return peak;
}

function render(memBytes, uptimeSec, activeReq, dnsCache) {
  var mb = memBytes / 1048576;
  var peak = trackPeak(mb, uptimeSec);

  var pct = ((mb / LIMIT_MB) * 100).toFixed(1);
  var peakPct = ((peak / LIMIT_MB) * 100).toFixed(1);
  var lines = [
    "▬▬▬ 当前 " + mb.toFixed(1) + " MB (" + pct + "%)",
    "┅┅┅ 峰值 " + peak.toFixed(1) + " MB (" + peakPct + "%)",
    dualBar(mb / LIMIT_MB, peak / LIMIT_MB, mb, peak),
  ];
  var extra = [];
  if (uptimeSec != null) extra.push("运行 " + fmtUptime(uptimeSec));
  if (activeReq != null) extra.push("请求 " + activeReq);
  if (dnsCache != null) extra.push("DNS " + dnsCache);
  if (extra.length) lines.push(extra.join(" | "));
  $done({
    title: "Surge 内存",
    content: lines.join("\n"),
    // 面板图标只能用 SF Symbol 名称；internaldrive.fill 是硬盘图标，
    // 表明存储（waveform.path 波形线不像存储，已换掉）。
    icon: "internaldrive.fill",
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

// ============ 详情面板 ============
// 优先走 /v1/mcp 的 dump_runtime_data（一次拿到全部计数字段），
// 拿不到时回退 /v1/metrics（虚拟 IP / 临时规则两项没有，显示 —）。
function renderDetail(d) {
  var mb = d.mem / 1048576;
  var peak = trackPeak(mb, d.uptime);
  var pct = ((mb / LIMIT_MB) * 100).toFixed(1);
  var peakPct = ((peak / LIMIT_MB) * 100).toFixed(1);
  var num = function (v, unit) {
    return v == null ? "—" : v + " " + unit;
  };
  var lines = [
    "▬▬▬ 当前 " + mb.toFixed(1) + " MB (" + pct + "%)",
    "┅┅┅ 峰值 " + peak.toFixed(1) + " MB (" + peakPct + "%)",
    dualBar(mb / LIMIT_MB, peak / LIMIT_MB, mb, peak),
    "DNS 缓存 " + num(d.dns, "条") + " | 虚拟 IP " + num(d.vip, "条"),
    "活动请求 " + num(d.activeReq, "个") + " | 临时规则 " + num(d.tempRules, "条"),
    "封禁 " + num(d.bans, "个") + " | 运行 " + (d.uptime != null ? fmtUptime(d.uptime) : "—"),
  ];
  $done({
    title: "Surge 内存详情",
    content: lines.join("\n"),
    icon: "list.bullet",
    "icon-color": colorFor(mb),
  });
}

function failDetail(msg) {
  $done({ title: "Surge 内存详情", content: "读取失败：" + msg, style: "error" });
}

function detailViaMetrics() {
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
          var bn = /surge_active_bans\s+(\d+)/.exec(text);
          renderDetail({
            mem: parseInt(m[1], 10),
            uptime: up ? parseFloat(up[1]) : null,
            activeReq: ar ? parseInt(ar[1], 10) : null,
            dns: dc ? parseInt(dc[1], 10) : null,
            vip: null,
            tempRules: null,
            bans: bn ? parseInt(bn[1], 10) : null,
          });
          return;
        }
      }
      failDetail("无内存数据");
    });
  } catch (e) {
    failDetail("接口不可用");
  }
}

function detailViaMcp() {
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
            renderDetail({
              mem: mem,
              uptime: data.uptime != null ? data.uptime : null,
              activeReq: data["active-requests"],
              dns: data["dns-cache-entries"],
              vip: data["virtual-ip-entries"],
              tempRules: data["temporary-rules"],
              bans: data["active-bans"],
            });
          } else {
            detailViaMetrics();
          }
        } catch (e2) {
          detailViaMetrics();
        }
      }
    );
  } catch (e) {
    detailViaMetrics();
  }
}

// 入口：按面板名分流；拿不到 $input 时默认经典面板。
var isDetail = false;
try {
  isDetail = $input && $input.panelName === "Surge 内存详情";
} catch (e) {}
if (isDetail) detailViaMcp();
else tryMetrics();
