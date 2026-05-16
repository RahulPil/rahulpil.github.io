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
    github: 'https://github.com/rahulpil',
    linkedin: 'https://www.linkedin.com/in/rahul-pillalamarri',
    scholar: 'https://scholar.google.com',
    twitter: '',
  },
  nav: [
    { href: '/projects', label: 'projects' },
    { href: '/notes', label: 'notes' },
    { href: '/blog', label: 'writing' },
    { href: '/experience', label: 'about' },
  ],
} as const;

export type SiteConfig = typeof SITE;
