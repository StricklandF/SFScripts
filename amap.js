// Anti-Ad Script for Amap Map
// Only remove splash screen Ad & main page banner Ad (2023-01-08 15:02)

if (!$response.body) $done({});
const url = $request.url;
let obj = JSON.parse($response.body);

if (url.includes("/msgbox/pull")) {
  // 高德地图-首页消息
  if (obj.msgs) {
    obj.msgs = [];
  }
} else if (obj.data) {
  if (url.includes("/faas/amap-navigation/main-page")) {
    // 高德地图-首页卡片
    if (obj.data.cardList) {
      obj.data.cardList = obj.data.cardList.filter((item) => {
        return item.dataKey === "LoginCard";
      });
    }
    // } else if (url.includes("/faas/amap-navigation/main-page-assets")) {
    //   // 高德地图-首页消息
    //   if (obj.data.pull3 && obj.data.pull3.msgs) {
    //     obj.data.pull3.msgs.starttime = 2208960000; // Unix 时间戳 2040-01-01 00:00:00
    //     obj.data.pull3.msgs.expiretime = 2209046399; // Unix 时间戳 2040-01-01 23:59:59
    //   }
 // } else if (url.includes("/shield/dsp/profile/index/nodefaasv3")) {
 //   // 高德地图-我的
 //   if (obj.data.cardList) {
 //     obj.data.cardList = obj.data.cardList.filter((item) => {
 //       return (
 //         // item.dataKey === "AnnualBillCardV2" || // 年度报告
 //         item.dataKey === "MyOrderCard" // 我的订单
          // item.dataKey === "GdRecommendCard" || // 高德推荐
          // item.dataKey === "SceneVehicleCard_recommend" || // 我的车辆
          // item.dataKey === "SceneVehicleCard_function" || // 我的车辆
          // item.dataKey === "PopularActivitiesCard" || // 热门活动
          // item.dataKey === "GameExcitation" || // 小德爱消除
          // item.dataKey === "GoodsShelvesCard" || // 精选服务
          // item.dataKey === "DiyMap_function" || // DIY 地图
  //      );
  //    });
  //  }
 // } else if (url.includes("/shield/search/new_hotword")) {
 //   // 高德地图-搜索框
 //   if (obj.data.header_hotword) {
 //     obj.data.header_hotword = [];
 //   }
  } else if (url.includes("/valueadded/alimama/splash_screen")) {
    // 高德地图-开屏广告
    if (obj.data.ad) {
      for (let item of obj.data.ad) {
        item.set.setting.display_time = 0;
        item.creative[0].start_time = 2208960000; // Unix 时间戳 2040-01-01 00:00:00
        item.creative[0].end_time = 2209046399; // Unix 时间戳 2040-01-01 23:59:59
      }
    }
  }
  else if (url.includes("/promotion-web/resource")) {
  // 打车页面弹窗
  let item = [
    "alpha", // 出行优惠套餐
    "banner",
    "bravo", // 第三方推广 喜马拉雅月卡
    "bubble",
    "charlie", // 横版推广 单单立减 领专属优惠 体验问卷
    "icon",
    "popup",
    "push", // 顶部通知 发单立享优惠
    "tips"
  ];
  if (obj.data) {
    item.forEach((i) => {
      delete obj.data[i];
    });
  }
}
}

body = JSON.stringify(obj);
$done({ body });
