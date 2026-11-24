// Tells Android the app is a productivity tool (android:appCategory), so launchers that group apps by kind can
// put it there (decided 2026-11-19). An installed APK has no Play Store category, so this is its only hint;
// each launcher decides whether to use it.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function appCategory(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:appCategory'] = 'productivity';
    return c;
  });
};
