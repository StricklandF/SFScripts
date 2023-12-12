// 2023-12-12 11:00

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

if (url.includes("/activity-server-dolphin/api/get-banner-app/")) {
  if (obj?.data?.dataList?.length > 0) {
    // 顶部banner
    obj.data.dataList = [];
  }
} else if (url.includes("/activity-server-dolphin/api/get-flow-window/")) {
  if (obj?.data?.dataList?.length > 0) {
    obj.data.dataList = [];
  }
} else if (url.includes("/message-center/api/v2/getmsg")) {
  const items = [
    "activity", // 精选活动
    "business", // 业务消息
    "news", // 资讯推送
    "stockNotify", // 智投必选
    "system" // 系统公告
  ];
  if (obj?.data) {
    for (let i of items) {
      if (obj?.data?.[i]?.newFlag) {
        obj.data[i].newFlag = 0;
      }
    }
  }
} else if (url.includes("/message-center/api/v2/catalogs/unread/")) {
  if (obj?.data?.unreadNum) {
    obj.data.unreadNum =
    {
      "1": 0,
      "2": 0
    }
  }
} else {
  $done({});
}

$done({ body: JSON.stringify(obj) });
