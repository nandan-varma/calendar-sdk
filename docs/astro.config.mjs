import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Deployed as a GitHub Pages project site, so every URL lives under BASE.
// Doc content uses root-absolute links (e.g. /guides/sync/); Astro does not
// rewrite those for `base`, so rehypeBaseLinks prefixes them at build time.
const BASE = '/calendar-sdk';

function rehypeBaseLinks() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'element' && node.tagName === 'a') {
        const href = node.properties?.href;
        if (
          typeof href === 'string' &&
          href.startsWith('/') &&
          !href.startsWith('//') &&
          !href.startsWith(`${BASE}/`)
        ) {
          node.properties.href = BASE + href;
        }
      }
      for (const child of node.children ?? []) {
        visit(child);
      }
    };
    visit(tree);
  };
}

export default defineConfig({
  site: 'https://nandan-varma.github.io',
  base: BASE,
  markdown: {
    rehypePlugins: [rehypeBaseLinks],
  },
  integrations: [
    starlight({
      title: 'calendar-sdk',
      description:
        'One TypeScript API for Google Calendar, Microsoft Graph, and CalDAV — events, calendars, availability, sync, and webhooks.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/nandan-varma/calendar-sdk' },
      ],
      editLink: {
        baseUrl: 'https://github.com/nandan-varma/calendar-sdk/edit/main/docs/',
      },
      sidebar: [
        {
          label: 'Start Here',
          items: [{ slug: 'getting-started/installation' }, { slug: 'getting-started/quickstart' }],
        },
        {
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Providers',
          autogenerate: { directory: 'providers' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
    }),
  ],
});
