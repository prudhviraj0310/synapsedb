import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'SynapseDB Data OS',
      customCss: ['./src/styles/custom.css'],
      logo: { src: './src/assets/logo.svg' },
      social: {
        github: 'https://github.com/prudhviraj0310/synapsedb',
      },
      sidebar: [
        { label: '5-Minute Quickstart', link: '/' },
        { label: 'Core Concepts', autogenerate: { directory: 'concepts' } },
        { label: 'Polyglot Routing', link: '/concepts/routing/' },
        { label: 'CLI Reference', autogenerate: { directory: 'cli' } },
        { label: 'Framework Integrations', autogenerate: { directory: 'frameworks' } }
      ],
    }),
  ],
});
