// One flat config for the whole workspace. ESLint 9 resolves the config from
// the directory it is run in, so keeping a single copy here — and running
// `eslint .` from the root — is cheaper than a re-export in every package.
// Imported by path: the root is not a workspace member, so `@lyra/config` does
// not resolve here.
export { default } from "./packages/config/eslint.config.js";
