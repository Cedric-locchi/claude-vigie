import js from '@eslint/js';
import globals from 'globals';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

// Deux chaînes dans un seul `npm run lint` : le code Node (JS) et l'UI Angular (TypeScript + templates).
export default tseslint.config(
  // ui/libs/ui : composants spartan générés, qu'on ne retouche pas (voir CLAUDE.md).
  { ignores: ['node_modules/**', 'dist/**', '**/dist/**', '.vigie/**', 'ui/.angular/**', 'ui/libs/ui/**'] },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    // `const { MISE_YES: _yes, ...reste } = env` : retirer une clé par déstructuration est voulu.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    files: ['ui/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // Même convention que le code Node : `_x` désigne un paramètre ou une clé volontairement ignorés.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['ui/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    // `x != null` (null ou undefined) est l'idiome des templates du projet.
    rules: { '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }] },
  },
);
