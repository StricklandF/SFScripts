// Removes IPO popup, bottom banner, news notification of uSmart HK 2023-11-03

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

if (url.includes("/jy-ipo-server/api/ipo-list/v2")) {
    if (obj?.data?.list?.length > 0) {
        for (let item of obj.data.list) {
            if (item?.remainingTime) {
                item.remainingTime = 0;
            }
            if (item?.ecmEndTime) {
                item.ecmEndTime = "2000-10-01 00:00:00";
            }
        }
    }
} else if (url.includes("/message-center/api/v2/getmsg")) {
    const items = ["news"];
    if (obj?.data) {
        for (let i of items) {
            if (obj?.data?.[i]?.newFlag) {
                obj.data[i].newFlag = 0;
            }
            // delete obj.data[i];
        }
    }
} else if (url.includes("/news-configserver/api/v1/query/banner_advertisement")) {
    if (obj?.data?.banner_list?.length > 0) {
        obj.data.banner_list = [];
    }
}

$done({ body: JSON.stringify(obj) });
