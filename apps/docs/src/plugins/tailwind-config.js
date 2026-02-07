module.exports = function tailwindPlugin(context, options) {
  return {
    name: "tailwind-plugin",
    configurePostCss(postcssOptions) {
      postcssOptions.plugins.push(
        require("tailwindcss"),
        require("autoprefixer")
      )
      return postcssOptions
    },
  }
}
