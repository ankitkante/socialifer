// The app shares ../public/rules.js (and later ../public/fields.js) with the server, so Metro must see public/.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../public')];

module.exports = config;
