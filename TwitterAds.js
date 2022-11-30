let twb = JSON.parse($response.body);
if (twb.biz) {
    twb.biz = Object.values(twb.biz).filter(item => !(item["type"]=="Promoted"));
}
$done({ body: JSON.stringify(twb) });
