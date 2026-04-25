const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Don't watch the root project's node_modules or other apps
config.watchFolders = [__dirname];

// Exclude parent directories from being watched
config.resolver.blockList = [
  /\.\.\/\.\.\/node_modules\/.*/,
  /\.\.\/\.\.\/\.medusa\/.*/,
  /\.\.\/\.\.\/src\/.*/,
  /\.\.\/partner-ui\/.*/,
  /\.\.\/media-gallery\/.*/,
];

// Reduce watcher polling
config.watcher = {
  ...config.watcher,
  healthCheck: {
    enabled: false,
  },
};

module.exports = config;
