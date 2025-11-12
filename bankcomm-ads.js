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
        if (hex === PNG_MAGIC) {
            $done({
                status: 403,
                headers: {},
                bodyBytes: new ArrayBuffer(0)
            });
            return;
        }
    } catch (e) {
    }
} else {
}

const currentHost = (function() {
    try {
        const urlString = $request?.url || $response?.url;
        if (urlString) {
            return new URL(urlString).hostname;
        }
    } catch (e) {
    }
    return null;
})();

const serverHeader = $response.headers?.Server || $response.headers?.server;

if (
    currentHost === 'gweb.dl.bankcomm.com' &&
    serverHeader &&
    String(serverHeader).toLowerCase().includes('openresty')
) {
    $done({
        status: 403,
        headers: {},
        bodyBytes: new ArrayBuffer(0)
    });
    return;
}

$done({});
