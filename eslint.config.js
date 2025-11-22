const {
    defineConfig,
} = require("eslint/config");

module.exports = defineConfig([{
    rules: {
        "brace-style": ["error", "allman"],
        "indent": ["error", "tab"],
        "no-tabs": "off",
    },
}]);
