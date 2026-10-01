#!/usr/bin/env node
// Compile the mockup-render Tailwind stylesheet (src/styles/mockup-tailwind.generated.css).
//
// The sheet is git-tracked and consumed only by scripts/mockup-eval-harness.mjs,
// which inlines it into the Playwright screenshot documents (the
// `mockup-harness` CI workflow relies on the committed copy). The app bundle
// never imports it, and tailwind.config.js excludes src/styles from its content
// scan. Run `npm run mockup-css:build` after expanding the safelist in
// scripts/mockup-tailwind.config.cjs.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const configPath = path.join(repoRoot, 'scripts', 'mockup-tailwind.config.cjs');
const inputPath = path.join(repoRoot, 'src', 'styles', 'mockup-tailwind.input.css');
const cssOutPath = path.join(repoRoot, 'src', 'styles', 'mockup-tailwind.generated.css');

const tailwindBin = path.join(repoRoot, 'node_modules', '.bin', 'tailwindcss');

console.log('[mockup-css] compiling Tailwind utilities…');
execFileSync(
    tailwindBin,
    ['-c', configPath, '-i', inputPath, '-o', cssOutPath, '--minify'],
    { stdio: 'inherit', cwd: repoRoot },
);
console.log(`[mockup-css] wrote ${path.relative(repoRoot, cssOutPath)}`);
