// The laptop's phone server is plain HTTP on the home Wi-Fi (requests are signed instead; see phone.js), and an
// installed Android app refuses plain HTTP unless the manifest allows it. Expo Go already allowed it, which is
// why this only matters for the APK. Android can't limit this to private addresses, so it's app-wide.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function allowHttp(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    return c;
  });
};
