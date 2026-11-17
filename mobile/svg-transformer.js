// Turns an imported .svg file into a module that exports its text (see Logo.js); everything else goes to Expo's own transformer.
const path = require('path');

const upstream = require(require.resolve('@expo/metro-config/build/babel-transformer', {
  paths: [path.dirname(require.resolve('expo/package.json'))],
}));

module.exports = {
  ...upstream,
  transform(props) {
    if (!props.filename.endsWith('.svg')) return upstream.transform(props);
    return upstream.transform({ ...props, src: `module.exports = ${JSON.stringify(props.src)};` });
  },
};
