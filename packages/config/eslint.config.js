// Shared flat ESLint config. Kept deliberately small: typecheck does the heavy
// lifting, lint guards the conventions typecheck cannot see.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.wrangler/**",
      "**/migrations/**",
      "**/.react-router/**",
      "**/.stryker-tmp/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      // CLAUDE.md rule 7: logical properties only. Physical CSS props in JS
      // string literals are caught by the stylelint-ish check in packages/ui tests.
      "no-restricted-syntax": [
        "error",
        {
          // CLAUDE.md rule 3: no provider SDK outside the model gateway.
          selector: "ImportDeclaration[source.value=/^(@anthropic-ai|openai)\\//]",
          message: "Model access only via @lyra/model-gateway (CLAUDE.md rule 3)."
        }
      ]
    }
  },
  {
    // Repo scripts run in Node, not a Worker. Only the globals they actually
    // use, so a stray `window` in one still gets caught.
    files: ["scripts/**/*.mjs", "**/*.config.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } }
  },
  {
    // Detox/Jest CommonJS config files: no bundler, loaded straight by Node.
    files: ["**/.detoxrc.js", "**/jest.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", require: "readonly" } }
  },
  {
    // Scoped to the two classic hooks rules, not the full `recommended` set:
    // v7's recommended config also ships newer, stricter rules (e.g.
    // set-state-in-effect) that fire across pre-existing, unrelated code.
    // Widening this is a separate cleanup, not part of this fix.
    files: ["**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  }
);
