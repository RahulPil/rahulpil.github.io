export const SITE = {
  name: 'Rahul Pillalamarri',
  shortName: 'rahul',
  email: 'rahulpil@tamu.edu',
  location: 'Texas A&M University',
  tagline: 'Machine learning, carefully.',
  description:
    'Projects, notes, and writing on machine learning — by Rahul Pillalamarri.',
  url: 'https://rahulpil.github.io',
  social: {
    github: 'https://github.com/RahulPil',
    linkedin: 'https://www.linkedin.com/in/rahul-pillalamarri',
    twitter: '',
  },
  nav: [
    { href: '/notes', label: 'notes' },
    { href: '/blog', label: 'writing' },
    { href: '/cv', label: 'cv' },
  ],
} as const;

export type SiteConfig = typeof SITE;
