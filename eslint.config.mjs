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
    files: ['ui/**/*.ts', 'plugins/*/ui/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      // Même convention que le code Node : `_x` désigne un paramètre ou une clé volontairement ignorés.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // Décision 037 : le front d'un plugin ne parle à Vigie que par le SDK. Permis : @vigie/plugin-sdk(/testing), @angular/*,
    // @spartan-ng/helm/*, zod/mini, ../contract.mjs (son contrat, pas sous un dossier contract/) et ses propres fichiers (./…).
    // Interdit : l'app (ui/src, SDK compris par chemin), le daemon, le contrat de Vigie, un autre plugin (sortie de plugins/<id>/).
    // ponytail: `../../*` suppose les fichiers à plat dans ui/ ; un sous-dossier de ui/ devra viser son contrat autrement (alias).
    files: ['plugins/*/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/ui/src/**', '**/daemon/**', '**/contract/**', '@vigie/contract', '@vigie/contract/**', '../../*', '../../**'], message: 'un plugin ne parle à Vigie que par @vigie/plugin-sdk (et son ../contract.mjs)' }],
        // Une chaîne d'un outil (nom de tâche, sortie de nx) ne doit jamais devenir du HTML de confiance.
        paths: [{ name: '@angular/platform-browser', importNames: ['DomSanitizer'], message: 'pas de DomSanitizer dans un plugin : le texte reste du texte' }],
      }],
      'no-restricted-syntax': ['error',
        { selector: "MemberExpression[property.name=/^bypassSecurityTrust/]", message: 'pas de bypassSecurityTrust* dans un plugin' },
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: 'pas de innerHTML dans un plugin : interpolation {{ }} seulement' },
      ],
    },
  },
  {
    // Gabarits en ligne des fronts de plugins (processInlineTemplates) : pas de liaison [innerHTML] / [outerHTML].
    files: ['plugins/*/ui/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
      'no-restricted-syntax': ['error', { selector: "BoundAttribute[name=/^(innerHTML|outerHTML)$/]", message: 'pas de [innerHTML] dans un plugin : interpolation {{ }} seulement' }],
    },
  },
  {
    files: ['ui/**/*.html'],
    extends: [...angular.configs.templateRecommended],
    // `x != null` (null ou undefined) est l'idiome des templates du projet.
    rules: { '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }] },
  },
);
