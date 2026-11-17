// The app shares ../public/rules.js and ../public/fields.js with the server, so Metro must see public/.
// The platform logos (../public/icons/*.svg) are read as text by svg-transformer.js, so both apps use the same files.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../public')];
config.transformer.babelTransformerPath = require.resolve('./svg-transformer.js');
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
