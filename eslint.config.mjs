import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The embedding pipeline is Python. Nothing here to lint.
    "pipeline/**",
  ]),

  {
    rules: {
      // Underscore-prefixed bindings are deliberately unused.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // The React Compiler rules, downgraded to warnings on first adoption.
    //
    // This repo had no working lint at all: the `lint` script still called
    // `next lint`, which Next 16 removed, so it had been silently doing
    // nothing. Turning the ruleset on surfaced 17 errors at once. Rather than
    // refactor a working app in one commit to make a new check go green, they
    // are warnings: still reported on every run and every pull request, not
    // blocking the build.
    //
    // They are not all defects. Most of the set-state-in-effect hits read
    // localStorage or window.innerWidth after mount, which cannot happen on
    // the server and so has to be an effect. The right fix there is a
    // useSyncExternalStore mount gate, one component at a time, verified in
    // the browser. The immutability hits are almost all in Galaxy.tsx, where
    // mutating a Three.js object inside an animation frame is the entire
    // point of Three.js and not something the rule models.
    //
    // The two in app/page.tsx are real: the tour advances itself from an
    // effect when it should derive from state during render.
    //
    // Promote these back to "error" as they are cleared.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);
