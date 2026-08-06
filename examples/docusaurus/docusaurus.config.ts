import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import type {PlantUmlPluginOptions} from '@matfsw/docusaurus-plantuml-plugin'; // plugin-package

/**
 * The example deliberately deploys under a non-root `baseUrl` so that every asset URL the
 * plugin emits is exercised the way a project-pages deployment would exercise it.
 */
const config: Config = {
  title: 'PlantUML plugin example',
  tagline: 'Client-side PlantUML rendering for Docusaurus 3',
  favicon: undefined,

  url: 'https://example.test',
  baseUrl: '/plantuml-test/',

  organizationName: 'matf',
  projectName: 'docusaurus-plantuml-plugin',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    /**
     * Only needed because this example consumes the plugin through a `file:../..` symlink.
     * Webpack resolves symlinks to their real path by default, so the plugin's theme
     * components would load `@docusaurus/theme-common` and `react` from the repository root
     * instead of from this site — two copies, two React contexts, and a `useColorMode`
     * called "outside the ColorModeProvider".
     *
     * A real installation from npm has no symlink and needs none of this; the packed-tarball
     * integration test in `scripts/test-packed-example.mjs` is what proves that.
     */
    function resolveLinkedPluginFromSite() {
      return {
        name: 'example-resolve-linked-plugin',
        configureWebpack() {
          return {resolve: {symlinks: false}};
        },
      };
    },
    [
      '@matfsw/docusaurus-plantuml-plugin', // plugin-package
      {
        languages: ['plantuml', 'puml'],
        theme: 'auto',
        lazy: true,
        cache: 'memory',
        sanitizeSvg: true,
        showSourceOnError: true,
        renderTimeoutMs: 20_000,
      } satisfies PlantUmlPluginOptions,
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
        },
        blog: {
          showReadingTime: true,
          onUntruncatedBlogPosts: 'ignore',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'PlantUML plugin example',
      items: [
        {type: 'docSidebar', sidebarId: 'exampleSidebar', position: 'left', label: 'Docs'},
        {to: '/blog', label: 'Blog', position: 'left'},
      ],
    },
    footer: {style: 'dark', copyright: 'PlantUML plugin example site'},
  } satisfies Preset.ThemeConfig,
};

export default config;
