// The APK is built for 64-bit ARM phones only (decided 2026-11-19). A universal APK carries React Native's engine
// for four chip types and came to about 90 MB; every mid-range or better Android phone of recent years is arm64.
// Very old or very cheap 32-bit phones, and Intel emulators, can't install it. Expo Go isn't affected.
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function arm64Only(config) {
  return withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'));
    c.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' });
    return c;
  });
};
