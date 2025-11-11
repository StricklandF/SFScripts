const PNG_MAGIC = '89504E470D0A1A0A';
const body = $response.bodyBytes;
const len = body?.byteLength || 0;

if (len >= 8) {
    try {
        const bytes = new Uint8Array(body);
        let hex = '';
        for (let i = 0; i < 8; i++) {
            hex += ('0' + bytes[i].toString(16)).slice(-2).toUpperCase();
        }
        // 对比
        if (hex === PNG_MAGIC) {
            // [日志] 匹配 PNG 签名，拒绝请求
           // console.log(`[拦截] 发现 PNG 文件头 (${hex})，返回 403 拒绝。`);

            // 返回 403 Forbidden 状态码，清空响应体和 Header
            $done({
                status: 403,
                headers: {},
                bodyBytes: new ArrayBuffer(0)
            });
            return;
        } else {
            // [日志] 不匹配，允许通过
           // console.log(`[放行] 文件头 (${hex}) 不匹配 PNG 签名。`);
        }
    } catch (e) {
        // [日志] 如果兼容性或转换失败，放行
       // console.error(`[错误] 解析数据失败，默认放行。错误信息: ${e.message}`);
    }
} else {
    // [日志] 数据太短或为空，默认放行
   // console.log(`[放行] 响应体长度 (${len} 字节) 不足 ${8} 字节。`);
}

// 默认放行原始响应
$done({});