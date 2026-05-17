#!/usr/bin/env node
/*
 * new-post.mjs
 * -----------------------------------------------------------------------------
 * Convert a source document (.tex / .md / .mdx / .pdf) into a properly-formed
 * MDX file inside one of the site's Astro content collections (`notes` or
 * `blog`). Writes the file at the canonical path for the chosen collection,
 * with a YAML frontmatter block built from CLI args.
 *
 * Requires Node 22 (ESM, parseArgs). No new npm deps. Pandoc/poppler are
 * shelled out to only when the input is .tex / .pdf respectively; install
 * via `brew install pandoc` and `brew install poppler`.
 *
 * Usage:
 *   node scripts/new-post.mjs --help
 *
 * Examples:
 *   # Convert a LaTeX note into the `notes` collection (topic required):
 *   node scripts/new-post.mjs \
 *     --input ~/papers/layernorm-notes.tex \
 *     --collection notes \
 *     --title "LayerNorm vs RMSNorm" \
 *     --topic deep-learning \
 *     --tags "transformers,normalization"
 *
 *   # Convert a Markdown draft into the `blog` collection:
 *   node scripts/new-post.mjs \
 *     --input ~/drafts/research-taste.md \
 *     --collection blog \
 *     --title "Notes on research taste" \
 *     --summary "What I think 'taste' actually means in ML research." \
 *     --date 2026-05-17
 * -----------------------------------------------------------------------------
 */

import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, extname, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const SUPPORTED_EXTS = ['.tex', '.md', '.mdx', '.pdf'];

const USAGE = `
Usage:
  node scripts/new-post.mjs \\
    --input <path>            (required) source file: .tex / .md / .mdx / .pdf
    --collection <name>       (required) "notes" or "blog"
    --title "<title>"         (required) post title
    --date <YYYY-MM-DD>       (optional) defaults to today
    --slug <slug>             (optional) defaults to kebab-case from title
    --topic <topic>           (required for notes) e.g. "deep-learning"
    --summary "<summary>"     (required for blog; optional for notes)
    --tags "<tag1,tag2>"      (optional) comma-separated
    --draft                   (optional) marks the post as draft
    --force                   (optional) overwrite if output file exists
    --help, -h                show this help

Examples:
  node scripts/new-post.mjs --input ~/notes/sinks.tex --collection notes \\
      --title "Attention sinks" --topic deep-learning --tags "transformers,attention"

  node scripts/new-post.mjs --input ~/drafts/post.md --collection blog \\
      --title "On research taste" --summary "What taste actually means."
`.trim();

function die(msg) {
  process.stderr.write(`error: ${msg}\n\n${USAGE}\n`);
  process.exitCode = 1;
}

function info(msg) {
  process.stdout.write(`${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`warning: ${msg}\n`);
}

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------

let parsed;
try {
  parsed = parseArgs({
    options: {
      input: { type: 'string' },
      collection: { type: 'string' },
      title: { type: 'string' },
      date: { type: 'string' },
      slug: { type: 'string' },
      topic: { type: 'string' },
      summary: { type: 'string' },
      tags: { type: 'string' },
      draft: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
} catch (err) {
  die(err.message);
  process.exit();
}

const args = parsed.values;

if (args.help) {
  info(USAGE);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

if (!args.input) {
  die('missing --input');
  process.exit();
}
if (!args.collection) {
  die('missing --collection');
  process.exit();
}
if (!['notes', 'blog'].includes(args.collection)) {
  die(`--collection must be "notes" or "blog" (got "${args.collection}")`);
  process.exit();
}
if (!args.title || !args.title.trim()) {
  die('missing --title');
  process.exit();
}

if (args.collection === 'notes' && !args.topic) {
  die('--topic is required for the notes collection');
  process.exit();
}
if (args.collection === 'blog' && (!args.summary || !args.summary.trim())) {
  die('--summary is required for the blog collection');
  process.exit();
}

// date: default to today (UTC, YYYY-MM-DD)
let dateStr = args.date;
if (!dateStr) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  dateStr = `${y}-${m}-${d}`;
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
  die(`--date must be YYYY-MM-DD (got "${dateStr}")`);
  process.exit();
}

// resolve input
const inputPath = resolve(process.cwd(), args.input);
if (!existsSync(inputPath)) {
  die(`input file not found: ${inputPath}`);
  process.exit();
}

const ext = extname(inputPath).toLowerCase();
if (!SUPPORTED_EXTS.includes(ext)) {
  die(
    `unsupported input extension "${ext}". Supported: ${SUPPORTED_EXTS.join(', ')}`,
  );
  process.exit();
}

// slug
function kebab(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}
const slug = args.slug ? kebab(args.slug) : kebab(args.title);
if (!slug) {
  die('could not derive a slug from --title; pass --slug explicitly');
  process.exit();
}

// topic (only used for notes) — kebab it too so directory naming is consistent
const topic = args.topic ? kebab(args.topic) : undefined;

// tags
let tags = [];
if (args.tags) {
  tags = args.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// body extraction
// ---------------------------------------------------------------------------

function stripFrontmatter(text) {
  // strip a leading `---\n...\n---\n?` block if present
  if (!text.startsWith('---')) return text;
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return text;
  return text.slice(match[0].length).replace(/^\s+/, '');
}

function runTool(bin, toolArgs, installHint) {
  try {
    return execFileSync(bin, toolArgs, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      die(`required tool "${bin}" not found on PATH. ${installHint}`);
      process.exit();
    }
    const stderr =
      err && err.stderr ? err.stderr.toString().trim() : err.message;
    die(`${bin} failed: ${stderr}`);
    process.exit();
  }
}

let body;
let pdfWarning = false;
if (ext === '.md' || ext === '.mdx') {
  const raw = readFileSync(inputPath, 'utf8');
  body = stripFrontmatter(raw);
} else if (ext === '.tex') {
  body = runTool(
    'pandoc',
    ['--from=latex', '--to=gfm-raw_html', inputPath],
    'Install with: brew install pandoc',
  );
} else if (ext === '.pdf') {
  body = runTool(
    'pdftotext',
    ['-layout', inputPath, '-'],
    'Install with: brew install poppler',
  );
  pdfWarning = true;
}

// normalize trailing whitespace
body = body.replace(/\s+$/, '') + '\n';

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

// Render a YAML string scalar. If the value contains `"` or other awkward
// characters, fall back to a folded block scalar (`>-`) to avoid escaping
// headaches and keep the YAML readable.
function yamlString(value) {
  const s = String(value);
  if (s.includes('"')) {
    // folded block scalar: collapses internal newlines into spaces; safe for
    // single-line titles/summaries that happen to contain quote chars.
    return `>-\n  ${s.replace(/\r?\n/g, ' ').trim()}`;
  }
  // simple double-quoted scalar; escape backslashes (other control chars are
  // not expected for titles/summaries in practice).
  return `"${s.replace(/\\/g, '\\\\')}"`;
}

function yamlTagsArray(arr) {
  if (!arr || arr.length === 0) return '[]';
  // simple inline array — each tag double-quoted; reject embedded quotes
  // (unlikely for tags but be explicit).
  return (
    '[' +
    arr
      .map((t) => {
        if (t.includes('"')) {
          throw new Error(`tag contains a double quote: ${t}`);
        }
        return `"${t}"`;
      })
      .join(', ') +
    ']'
  );
}

// Build frontmatter lines in a stable, schema-friendly order.
const fmLines = [];
fmLines.push(`title: ${yamlString(args.title.trim())}`);

if (args.collection === 'blog') {
  fmLines.push(`summary: ${yamlString(args.summary.trim())}`);
} else {
  if (args.summary && args.summary.trim()) {
    fmLines.push(`summary: ${yamlString(args.summary.trim())}`);
  }
  fmLines.push(`topic: ${yamlString(topic)}`);
}

fmLines.push(`date: ${dateStr}`);
fmLines.push(`tags: ${yamlTagsArray(tags)}`);
fmLines.push(`draft: ${args.draft ? 'true' : 'false'}`);

const frontmatter = fmLines.join('\n');

// ---------------------------------------------------------------------------
// output path + write
// ---------------------------------------------------------------------------

const outRel =
  args.collection === 'notes'
    ? `src/content/notes/${topic}/${slug}.mdx`
    : `src/content/blog/${slug}.mdx`;
const outAbs = resolve(REPO_ROOT, outRel);

if (existsSync(outAbs) && !args.force) {
  die(`output file already exists: ${outRel} (pass --force to overwrite)`);
  process.exit();
}

try {
  mkdirSync(dirname(outAbs), { recursive: true });
} catch (err) {
  die(`could not create directory ${dirname(outAbs)}: ${err.message}`);
  process.exit();
}

const finalContent = `---\n${frontmatter}\n---\n\n${body}`;

try {
  writeFileSync(outAbs, finalContent, 'utf8');
} catch (err) {
  die(`could not write ${outAbs}: ${err.message}`);
  process.exit();
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

const printableRel = relative(REPO_ROOT, outAbs);
info(`\nwrote ${printableRel}\n`);
info('--- frontmatter ---');
info(frontmatter);
info('-------------------\n');

if (pdfWarning) {
  warn(
    'PDF extracted; review the output for formatting issues (tables, math, code blocks may need manual cleanup).',
  );
  info('');
}

info('next steps:');
info(
  '  1. Restart the Astro dev server (`npm run dev`) — Astro needs a restart to pick up newly-added content collection files.',
);
info('  2. Verify the build with `npm run build`.');
