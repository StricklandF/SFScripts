// 节点 IP 质量检测 · Quantumult X event-interaction 脚本

const IPPURE_URL = "https://my.ippure.com/v1/info";
const IPAPI_URL = "https://api.ipapi.is/";
const IPAPI_COM_URL = "http://ip-api.com/json/";
const IPQUALITY_BACKEND = "https://ipinfo.check.place";
const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

// QX event-interaction 参数解析
const nodeName = typeof $environment !== "undefined" && $environment.params
    ? String($environment.params).trim()
    : "";
const maskIP = readSwitch("MaskIP", false);

// console.log(`[INFO] 节点 IP 质量检测`);
// console.log(`[INFO] 节点: ${nodeName || "未获取"}`);

if (!nodeName) {
    finishError("未获取到节点或策略组名称");
} else {
    run().catch((error) => finishError(`检测异常: ${errorMessage(error)}`));
}

async function run() {
    const discovery = await discoverIP();
    if (!discovery.ip) throw new Error("无法获取所选节点的出口 IP");

    const ip = discovery.ip;
    const databaseData = await collectDatabases(ip, discovery);
    render(ip, databaseData);
}

async function discoverIP() {
    const definitions = [
        ["ipinfo.check.place", requestText(`${IPQUALITY_BACKEND}/cdn-cgi/trace`)],
        ["myip.check.place", requestText("https://myip.check.place")],
        ["ip-api", requestJson(`${IPAPI_COM_URL}?fields=status,message,query`)],
        ["ident.me", requestText("https://v4.ident.me/")],
        ["icanhazip", requestText("https://ipv4.icanhazip.com/")],
        ["IPPure", requestIppure()],
        ["ipapi", requestJson(IPAPI_URL)],
    ];
    const settled = await Promise.all(definitions.map((item) => capture(item[1])));
    const observations = [];
    let ippure = null;
    let ippureError = "";
    let ipapi = null;

    definitions.forEach((item, index) => {
        const result = settled[index];
        if (!result.ok) {
            if (item[0] === "IPPure") ippureError = result.error;
            // console.log(`[WARN] 出口探针 ${item[0]}: ${result.error}`);
            return;
        }
        const value = result.value;
        if (item[0] === "IPPure") ippure = value;
        if (item[0] === "ipapi") ipapi = value;

        // 提取候选 IP
        let candidate = "";
        if (item[0] === "ipinfo.check.place") {
            candidate = cloudflareTraceIP(value);
        } else if (item[0] === "ip-api") {
            candidate = value && value.query;
        } else if (item[0] === "IPPure" || item[0] === "ipapi") {
            candidate = value && value.ip;
        } else {
            candidate = String(value || "").trim();
        }

        const normalizedCandidate = normalizeIPAddress(candidate);
        if (normalizedCandidate) {
            observations.push({
                source: item[0],
                ip: normalizedCandidate,
            });
        }
    });

    if (!observations.length) {
        return { ip: "", ippure: null, ipapi: null, probe: { matched: 0, total: 0 } };
    }

    const counts = {};
    observations.forEach((item) => {
        counts[item.ip] = (counts[item.ip] || 0) + 1;
    });

    const backendObservation = observations.find((item) => item.source === "ipinfo.check.place")
        || observations.find((item) => item.source === "myip.check.place");

    const ip = backendObservation ? backendObservation.ip : observations.map((item) => item.ip)
        .sort((left, right) => {
            const countDiff = counts[right] - counts[left];
            if (countDiff) return countDiff;
            const ipv4Diff = Number(isIPv4(right)) - Number(isIPv4(left));
            if (ipv4Diff) return ipv4Diff;
            return observations.findIndex((item) => item.ip === left)
                - observations.findIndex((item) => item.ip === right);
        })[0];

    const matchingIpapi = ipapi && normalizeIPAddress(ipapi.ip) === ip ? ipapi : null;
    const unique = Object.keys(counts);
    if (unique.length > 1) {
        // console.log(`[WARN] 出口探针不一致: ${observations.map((item) => `${item.source}=${item.ip}`).join(", ")}`);
    }

    return {
        ip,
        ippure,
        ippureError,
        ipapi: matchingIpapi,
        probe: {
            matched: counts[ip],
            total: observations.length,
            unique: unique.length,
        },
    };
}

async function collectDatabases(ip, discovery) {
    const pathIP = encodeURIComponent(ip);
    const tasks = {
        geoIpApi: requestJson(`${IPAPI_COM_URL}${pathIP}?lang=zh-CN`, { node: "DIRECT", timeout: 5000 }),
        ippure: discovery.ippure
            ? Promise.resolve(discovery.ippure)
            : Promise.reject(new Error(discovery.ippureError || "IPPure 请求失败")),
        ipapi: discovery.ipapi
            ? Promise.resolve(discovery.ipapi)
            : requestJson(`${IPAPI_URL}?q=${pathIP}`, { node: "DIRECT" }),
        ipinfo: requestJson(`https://ipinfo.io/widget/demo/${pathIP}`, { node: "DIRECT" }),
        scamalytics: requestScamalytics(pathIP),
        abuseipdb: requestBackendJson(`${IPQUALITY_BACKEND}/${pathIP}?db=abuseipdb`),
        ip2locationFull: requestBackendJson(`${IPQUALITY_BACKEND}/${pathIP}?db=ip2location`),
        ip2location: requestText(`https://www.ip2location.io/${pathIP}`, { node: "DIRECT", timeout: 5000 }),
        dbip: requestText(`https://db-ip.com/${pathIP}`, { node: "DIRECT", timeout: 5000 }),
    };

    const keys = Object.keys(tasks);
    const settled = await Promise.all(keys.map((key) => capture(tasks[key])));
    const data = {
        _errors: {},
        _warnings: {},
    };
    keys.forEach((key, index) => {
        const value = settled[index].ok ? settled[index].value : null;
        const mismatch = value ? databaseIPMismatch(key, value, ip) : "";
        if (key === "ippure" && value && !normalizeIPAddress(value.ip)) {
            data[key] = null;
            data._errors[key] = "IPPure 未返回可核验的出口 IP";
            // console.log(`[WARN] ${key}: ${data._errors[key]}`);
            return;
        }
        if (key === "ippure" && value && mismatch) {
            data[key] = Object.assign({}, value, { _egressMismatch: true });
            data._warnings[key] = mismatch;
            // console.log(`[WARN] ${key}: ${mismatch}，保留为分流出口结果`);
            return;
        }
        data[key] = mismatch ? null : value;
        if (!settled[index].ok || mismatch) {
            data._errors[key] = mismatch || settled[index].error;
            // console.log(`[WARN] ${key}: ${data._errors[key]}`);
        }
    });
    return data;
}

async function requestBackendJson(url) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            return await requestJson(url, { timeout: 5000 });
        } catch (error) {
            lastError = error;
            if (!/HTTP 403\b/i.test(errorMessage(error)) || attempt >= 3) throw error;
            // console.log(`[WARN] 聚合接口返回 403，第 ${attempt} 次重试`);
        }
    }
    throw lastError || new Error("聚合接口请求失败");
}

async function requestIppure() {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const value = await requestJson(IPPURE_URL, {
                headers: {},
                timeout: 5000,
            });
            if (!normalizeIPAddress(value && value.ip)) {
                throw new Error("未返回可核验的出口 IP");
            }
            const fraudScore = numberOrNull(value.fraudScore);
            if (fraudScore === null || fraudScore < 0 || fraudScore > 100) {
                throw new Error("风险评分无效");
            }
            return value;
        } catch (error) {
            lastError = error;
            if (attempt < 3) {
                // console.log(`[WARN] IPPure 第 ${attempt} 次请求失败，正在重试: ${errorMessage(error)}`);
            }
        }
    }
    throw lastError || new Error("IPPure 请求失败");
}

async function requestScamalytics(pathIP) {
    try {
        const backend = await requestBackendJson(`${IPQUALITY_BACKEND}/${pathIP}?db=scamalytics`);
        const score = numberOrNull(
            valueAt(backend, "scamalytics.scamalytics_score") ?? 
            valueAt(backend, "scamalytics_score") ?? 
            valueAt(backend, "data.scamalytics_score")
        );
        if (score === null) {
            throw new Error("聚合接口未包含有效的 scamalytics_score 字段");
        }
        return backend;
    } catch (backendError) {
        // console.log(`[WARN] Scamalytics 聚合接口失败，尝试经节点访问官网: ${errorMessage(backendError)}`);
        const html = await requestText(`https://scamalytics.com/ip/${pathIP}`, {
            headers: browserHeaders(),
            timeout: 6000
        });
        const parsed = parseScamalyticsHtml(html, decodeURIComponent(pathIP));
        if (!parsed) throw new Error("Scamalytics 官网页面解析失败");
        return parsed;
    }
}

function databaseIPMismatch(key, value, expectedIP) {
    const paths = {
        ippure: ["ip"],
        ipapi: ["ip"],
        ipinfo: ["data.ip"],
        scamalytics: ["ip"],
        abuseipdb: ["data.ipAddress"],
        ip2locationFull: ["ip"],
    };
    const candidates = paths[key] || [];
    let reported = "";
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = cleanValue(valueAt(value, candidates[i]));
        if (candidate) {
            reported = candidate;
            break;
        }
    }
    if (!reported) return "";
    const normalizedReported = normalizeIPAddress(reported);
    const normalizedExpected = normalizeIPAddress(expectedIP);
    return normalizedReported && normalizedExpected && normalizedReported === normalizedExpected
        ? ""
        : `响应 IP ${reported} 与检测 IP ${expectedIP} 不一致`;
}

function render(ip, data) {
    const types = buildTypes(data);
    const risks = buildRisks(data);
    const locationInfo = buildLocationInfo(data.geoIpApi);
    const titleColor = reportColor(risks);
    const displayNodeName = truncateText(nodeName, 30);
    const displayIP = maskIPAddress(ip);

    const html = [
        '<div style="font-family:-apple-system,BlinkMacSystemFont;font-size:14px;line-height:1.5;text-align:left;overflow-wrap:anywhere">',
        '<div style="font-size:18px;line-height:18px">&nbsp;</div>',
        `<div style="color:#64D2FF;font-size:16px;margin-bottom:16px">${escapeHtml(displayNodeName)}</div>`,
        `<div style="margin-bottom:16px"><div style="font-size:14px;font-weight:800;line-height:1.15;letter-spacing:0.2px">${escapeHtml(displayIP)}</div></div>`,
        section("基础信息", locationInfo),
        section("IP 类型属性", renderTypeList(types)),
        section("风险评分", renderRiskList(risks)),
        "</div>",
    ].join("");

    $done({
        title: "\u200B",
        htmlMessage: html,
        icon: "shield.lefthalf.filled",
        "title-color": titleColor,
    });
}

function buildLocationInfo(geoData) {
    if (!geoData || geoData.status !== "success") {
        return mutedLine("未能获取位置及运营商信息");
    }

    const country = cleanValue(geoData.country);
    const regionName = cleanValue(geoData.regionName);
    const city = cleanValue(geoData.city);
    const isp = cleanValue(geoData.isp) || cleanValue(geoData.org) || cleanValue(geoData.as);

    const locArr = [];
    if (country) locArr.push(country);
    if (regionName && regionName !== country) locArr.push(regionName);
    if (city && city !== regionName) locArr.push(city);

    const locText = locArr.join(" - ") || "未知位置";
    const ispText = isp || "未知运营商";

    return '<div style="margin-bottom:11px">'
        + `<div style="font-weight:700"><span style="color:#64D2FF">位置：</span>${escapeHtml(locText)}</div>`
        + `<div style="margin-top:2px;font-size:12px;line-height:1.5"><span style="color:#64D2FF;font-weight:700">运营商：</span>${escapeHtml(ispText)}</div>`
        + "</div>";
}

function buildTypes(data) {
    const ipinfo = data.ipinfo && data.ipinfo.data ? data.ipinfo.data : null;
    const ipapi = data.ipapi;
    const ip2 = getIp2location(data);
    const abuse = data.abuseipdb && data.abuseipdb.data ? data.abuseipdb.data : null;
    return [
        typeRow('<span style="color:#64D2FF">IPinfo</span>', valueAt(ipinfo, "asn.type")),
        typeRow('<span style="color:#64D2FF">ipapi</span>', valueAt(ipapi, "asn.type")),
        typeRow('<span style="color:#64D2FF">IP2Location</span>', ip2 && ip2.usage_type),
        typeRow('<span style="color:#64D2FF">AbuseIPDB</span>', abuse && abuse.usageType),
    ].filter((row) => row.usage);
}

function buildRisks(data) {
    const ippureScore = numberOrNull(data.ippure && data.ippure.fraudScore);
    const ippureMismatch = !!(data.ippure && data.ippure._egressMismatch);
    const ipapiText = data.ipapi && data.ipapi.company
        ? data.ipapi.company.abuser_score
        : "";
    const ipapiMatch = String(ipapiText || "").match(/([0-9.]+)\s*\(([^)]+)\)/);
    const ipapiRatio = ipapiMatch ? Number(ipapiMatch[1]) : NaN;
    const ipapiLevel = ipapiMatch ? ipapiMatch[2] : "";
    const ip2 = getIp2location(data);
    const ip2Score = numberOrNull(ip2 && ip2.fraud_score);
    const scam = data.scamalytics && data.scamalytics.scamalytics
        ? data.scamalytics.scamalytics
        : null;
    const scamScore = numberOrNull(scam && scam.scamalytics_score);
    const abuseScore = numberOrNull(valueAt(data, "abuseipdb.data.abuseConfidenceScore"));
    const dbipRisk = parseDbipRisk(data.dbip);

    const ippureRisk = scoreRisk(ippureMismatch ? '<span style="color:#64D2FF">IPPure（分流出口）</span>' : '<span style="color:#64D2FF">IPPure</span>', ippureScore, [
        [80, 4, "极高风险"],
        [70, 3, "高风险"],
        [40, 2, "中风险"],
        [0, 0, "低风险"],
    ]);
    if (ippureRisk.available && ippureMismatch) {
        ippureRisk.detail = `${ippureRisk.detail} · ${maskIPAddress(data.ippure.ip)}`;
        ippureRisk.affectsReport = false;
    }

    return [
        ippureRisk,
        ipapiMatch && Number.isFinite(ipapiRatio)
            ? {
                name: '<span style="color:#64D2FF">ipapi</span>',
                available: true,
                severity: ipapiSeverity(ipapiLevel),
                label: translateRisk(ipapiLevel),
                detail: `${round(ipapiRatio * 100, 2)}%`,
            }
            : unavailableRisk('<span style="color:#64D2FF">ipapi</span>'),
        scoreRisk('<span style="color:#64D2FF">IP2Location</span>', ip2Score, [
            [66, 3, "高风险"],
            [33, 2, "中风险"],
            [0, 0, "低风险"],
        ]),
        scoreRisk('<span style="color:#64D2FF">Scamalytics</span>', scamScore, [
            [90, 4, "极高风险"],
            [60, 3, "高风险"],
            [20, 2, "中风险"],
            [0, 0, "低风险"],
        ]),
        scoreRisk('<span style="color:#64D2FF">AbuseIPDB</span>', abuseScore, [
            [75, 4, "建议封禁"],
            [25, 3, "高风险"],
            [0, 0, "低风险"],
        ]),
        dbipRisk
            ? {
                name: '<span style="color:#64D2FF">DB-IP</span>',
                available: true,
                severity: dbipRisk === "high" ? 3 : dbipRisk === "medium" ? 2 : 0,
                label: dbipRisk === "high" ? "高风险" : dbipRisk === "medium" ? "中风险" : "低风险",
                detail: dbipRisk,
            }
            : unavailableRisk('<span style="color:#64D2FF">DB-IP</span>'),
    ].filter((item) => item && item.available);
}

function parseIp2location(html) {
    if (!html) return null;
    const text = String(html);
    const usage = text.match(/Usage\s*Type<\/label>\s*<p[^>]*>\s*\(([A-Z]+(?:\/[A-Z]+)*)\)/i)
        || text.match(/Usage\s*Type<\/label>\s*<p[^>]*>\s*([A-Z]+(?:\/[A-Z]+)*)\b/i);
    const fraud = text.match(/Fraud\s*Score<\/label>\s*<p[^>]*>\s*(\d+(?:\.\d+)?)/i);
    if (!usage && !fraud) return null;
    return {
        usageType: usage ? usage[1].toUpperCase() : null,
        fraudScore: fraud ? Number(fraud[1]) : null,
    };
}

function parseScamalyticsHtml(html, ip) {
    if (!html || /Attention Required|unable to access|cf-error-details/i.test(String(html))) {
        return null;
    }
    const text = String(html);
    const targetIP = normalizeIPAddress(ip);
    
    if (targetIP && !text.includes(targetIP)) return null;

    const scoreMatch = text.match(/Fraud\s*Score\b[\s\S]*?(\d{1,3})/i);
    if (!scoreMatch) return null;

    const scoreValue = Number(scoreMatch[1]);
    if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 100) return null;

    return {
        ip,
        scamalytics: {
            scamalytics_score: scoreValue,
        },
        _fallback: true,
    };
}

function getIp2location(data) {
    const full = data && data.ip2locationFull;
    if (full && typeof full === "object"
        && (cleanValue(full.usage_type) || numberOrNull(full.fraud_score) !== null)) {
        return full;
    }
    const parsed = parseIp2location(data && data.ip2location);
    if (!parsed) return null;
    return {
        usage_type: parsed.usageType,
        fraud_score: parsed.fraudScore,
        as_info: { as_usage_type: null },
        _fallback: true,
    };
}

function parseDbipRisk(html) {
    if (!html) return "";
    const match = String(html).match(/Estimated threat level for this IP address is\s*<span[^>]*>\s*([^<\s]+)/i);
    return match ? String(match[1]).toLowerCase() : "";
}

function scoreRisk(name, score, thresholds) {
    if (score === null) return unavailableRisk(name);
    for (let i = 0; i < thresholds.length; i += 1) {
        if (score >= thresholds[i][0]) {
            return {
                name,
                available: true,
                severity: thresholds[i][1],
                label: thresholds[i][2],
                detail: String(round(score, 2)),
            };
        }
    }
    return unavailableRisk(name);
}

function unavailableRisk(name) {
    return { name, available: false, severity: 0, label: "", detail: "" };
}

function ipapiSeverity(level) {
    const value = String(level || "").toLowerCase();
    if (value === "very high") return 4;
    if (value === "high") return 3;
    if (value === "elevated") return 2;
    return 0;
}

function translateRisk(level) {
    const map = {
        "very low": "极低风险",
        low: "低风险",
        elevated: "较高风险",
        high: "高风险",
        "very high": "极高风险",
    };
    return map[String(level || "").toLowerCase()] || String(level || "未知");
}

function typeRow(name, usage) {
    const cleanUsage = cleanValue(usage);
    return {
        name,
        usage: cleanUsage ? formatTypeWithRaw(cleanUsage) : "",
    };
}

function renderRiskList(rows) {
    const available = rows.filter((row) => row.available);
    if (!available.length) return mutedLine("本次没有可验证的风险评分");
    return available.map((row) => {
        const color = row.severity === null ? "#0A84FF" : riskColor(row.severity);
        return '<div style="margin-bottom:9px">'
            + `<span style="color:${color};font-size:11px">●</span>&nbsp;`
            + `<span style="font-weight:700">${row.name}</span>&nbsp;&nbsp;`
            + `<span style="color:${color};font-weight:600">${escapeHtml([row.detail, row.label].filter(Boolean).join(" · "))}</span>`
            + "</div>";
    }).join("");
}

function renderTypeList(rows) {
    if (!rows.length) return mutedLine("本次没有可验证的网络类型");
    return rows.map((row) => {
        return '<div style="margin-bottom:11px">'
            + `<div style="font-weight:700">${row.name}</div>`
            + `<div style="margin-top:2px;font-size:12px;line-height:1.5">${escapeHtml(row.usage)}</div>`
            + "</div>";
    }).join("");
}

function riskColor(severity) {
    if (severity >= 4) return "#8e0000";
    if (severity >= 3) return "#ff3b30";
    if (severity >= 2) return "#ff9500";
    return "#00a67d";
}

function reportColor(rows) {
    const severities = rows.filter((row) => {
        return row.available && row.severity !== null && row.affectsReport !== false;
    })
        .map((row) => row.severity);
    if (!severities.length) return "#8e8e93";
    const highest = Math.max.apply(null, severities);
    return highest >= 3 ? "#ff453a" : highest >= 2 ? "#ff9f0a" : "#30d158";
}

function section(title, content) {
    return '<div style="font-size:8px;line-height:8px">&nbsp;</div>'
        + '<div>'
        + `<div style="color:#0A84FF;font-weight:700;font-size:15px;margin-bottom:9px">▌${escapeHtml(title)}</div>`
        + `${content}</div>`;
}

function mutedLine(value) {
    return `<div style="color:#8e8e93;font-size:11px;margin:5px 0;line-height:1.45">${escapeHtml(value)}</div>`;
}

function browserHeaders() {
    return {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
    };
}

function backendHeaders() {
    return {
        Accept: "application/json",
        "User-Agent": "curl/8.7.1",
    };
}

function requestJson(url, options) {
    const config = options || {};
    return request(config.method || "GET", url, config).then((response) => {
        try {
            return JSON.parse(response.body);
        } catch (_) {
            throw new Error("JSON 响应解析失败");
        }
    });
}

function requestText(url, options) {
    const config = options || {};
    return request(config.method || "GET", url, config).then((response) => response.body);
}

function request(method, url, options) {
    const config = options || {};
    return new Promise((resolve, reject) => {
        const backendRequest = String(url).indexOf(IPQUALITY_BACKEND) === 0;
        const configuredPolicy = cleanValue(config.node);
        const policy = configuredPolicy.toUpperCase() === "DIRECT"
            ? "DIRECT"
            : configuredPolicy || nodeName;
        const requestOptions = {
            url,
            method: String(method || "GET").toUpperCase(),
            headers: config.headers || (backendRequest ? backendHeaders() : browserHeaders()),
            opts: { policy },
            timeout: config.timeout || 6000
        };
        if (typeof config.body !== "undefined") requestOptions.body = config.body;
        $task.fetch(requestOptions).then((response) => {
            const status = Number(response && (response.statusCode || response.status));
            if (!config.allowHttpErrors && (!Number.isFinite(status) || status < 200 || status >= 300)) {
                reject(new Error(`HTTP ${status || "?"}`));
                return;
            }
            resolve({ status, body: String((response && response.body) || ""), response: response || {} });
        }, (error) => reject(new Error(errorMessage(error))));
    });
}

function capture(promise) {
    return Promise.resolve(promise).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error: errorMessage(error) })
    );
}

function readSwitch(key, defaultValue) {
    const value = $prefs.valueForKey(key);
    if (value === null || typeof value === "undefined" || value === "") return defaultValue;
    return !(value === false || value === 0 || value === "false" || value === "0");
}

function isIPAddress(value) {
    if (!value) return false;
    const text = String(value).trim();
    return isIPv4(text) || (/^[0-9a-f:]+$/i.test(text) && text.indexOf(":") >= 0);
}

function isIPv4(value) {
    const parts = String(value || "").trim().split(".");
    return parts.length === 4 && parts.every((part) => {
        return /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255;
    });
}

function normalizeIPAddress(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!isIPAddress(text)) return "";
    if (isIPv4(text)) return text;
    try {
        return new URL(`http://[${text}]/`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch (_) {
        return text;
    }
}

function cloudflareTraceIP(value) {
    const match = String(value || "").match(/(?:^|\n)ip=([^\r\n]+)/);
    return match ? match[1].trim() : "";
}

function maskIPAddress(ip) {
    if (!maskIP || !ip) return ip;
    const text = String(ip);
    const parts = text.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
    const v6 = text.split(":");
    return v6.length > 3 ? `${v6.slice(0, 4).join(":")}:*` : text;
}

function valueAt(object, path) {
    if (!object) return null;
    const keys = String(path).split(".");
    let value = object;
    for (let i = 0; i < keys.length; i += 1) {
        if (value === null || typeof value === "undefined") return null;
        value = value[keys[i]];
    }
    return value;
}

function formatType(type) {
    const clean = cleanValue(type);
    if (!clean) return "未取到";
    const phraseMap = {
        "DATA CENTER/WEB HOSTING/TRANSIT": "机房",
        "FIXED LINE ISP": "家宽",
        "MOBILE ISP": "手机",
        "CONTENT DELIVERY NETWORK": "CDN",
        "DATA CENTER/TRANSIT": "机房",
        "SEARCH ENGINE SPIDER": "搜索引擎",
        "UNIVERSITY/COLLEGE/SCHOOL": "教育",
    };
    if (phraseMap[clean.toUpperCase()]) return phraseMap[clean.toUpperCase()];
    const map = {
        DCH: "机房",
        WEB: "机房",
        SES: "搜索引擎",
        HOSTING: "机房",
        ISP: "家宽",
        RES: "住宅",
        RESIDENTIAL: "住宅",
        BUSINESS: "商业",
        COMMERCIAL: "商业",
        BANKING: "银行",
        COM: "商业",
        MOB: "手机",
        MOBILE: "手机",
        CDN: "CDN",
        EDU: "教育",
        MIL: "军队",
        MILITARY: "军队",
        LIB: "图书馆",
        LIBRARY: "图书馆",
        RSV: "保留",
        RESERVED: "保留",
        GOVERNMENT: "政府",
        GOV: "政府",
        ORG: "组织",
        ORGANIZATION: "组织",
    };
    const first = clean.split("/")[0].trim();
    const key = first.toUpperCase();
    return map[key] || first;
}

function formatTypeWithRaw(type) {
    const clean = cleanValue(type);
    if (!clean) return "—";
    const formatted = formatType(clean);
    return formatted.toLowerCase() === clean.toLowerCase()
        ? formatted
        : `${formatted} (${clean})`;
}

function cleanValue(value) {
    if (value === null || typeof value === "undefined") return "";
    const text = String(value).trim();
    if (!text || /^(null|undefined|n\/a|unknown|-)$/i.test(text)) return "";
    return text;
}

function truncateText(value, maxLength) {
    const text = String(value || "");
    const limit = Number(maxLength) || 0;
    return limit > 1 && text.length > limit
        ? `${text.slice(0, limit - 1)}…`
        : text;
}

function numberOrNull(value) {
    if (value === null || typeof value === "undefined" || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
}

function escapeHtml(value) {
    return String(value === null || typeof value === "undefined" ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function errorMessage(error) {
    return error && error.message ? String(error.message) : String(error);
}

function finishError(message) {
    $done({
        title: "节点 IP 质量检测",
        message,
        icon: "network.slash",
    });
}
