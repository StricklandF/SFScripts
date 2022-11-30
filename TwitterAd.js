[rewrite_local]
^https?:\/\/api-*-0-0\.twitter\.com\/ url script-response-body https://raw.githubusercontent.com/StricklandF/SFScripts/main/TwitterAds.js
^https?:\/\/*\.twitter\.com\/ url script-response-body https://raw.githubusercontent.com/StricklandF/SFScripts/main/TwitterAds.js

[mitm]
hostname= api-*-0-0.twitter.com, *.twitter.com
