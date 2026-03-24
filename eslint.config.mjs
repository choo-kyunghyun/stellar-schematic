import globals from "globals";

export default [{
    files: ["**/*.js"],
    languageOptions: {
        globals: {
            ...globals.browser,
            ...globals.commonjs,
            ...globals.node,
            ...globals.mocha,
        },

        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "no-const-assign": "warn",
        "no-this-before-super": "warn",
        "no-undef": "warn",
        "no-unreachable": "warn",
        "no-unused-vars": "warn",
        "constructor-super": "warn",
        "valid-typeof": "warn",
    },
}, {
    files: ["src/app/frontend/scripts/**/*.js"],
    languageOptions: {
        sourceType: "script",
        globals: {
            ...globals.browser,
            AccessModifier: "readonly",
            acquireVsCodeApi: "readonly",
            DOMUtils: "readonly",
            Graph: "readonly",
            Store: "readonly",
            StringUtils: "readonly",
            WorkspaceUI: "readonly",
            mermaid: "readonly",
        },
    },

    rules: {
        "no-unused-vars": "off",
    },
}];