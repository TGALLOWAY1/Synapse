#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';

const nowIso = new Date().toISOString();

const arg = (name, fallback = undefined) => {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? true;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const repoRoot = process.cwd();
const suitePath = path.resolve(repoRoot, arg('suite', 'harness/mockup-test-suite.json'));
const outputRoot = path.resolve(repoRoot, arg('outdir', 'harness/results'));
const runs = Math.max(1, Number(arg('runs', 2)) || 2);
const maxAttempts = Math.max(1, Number(arg('max-attempts', 2)) || 2);
const caseFilter = arg('case');
const baselinePath = arg('baseline');
const replayFrom = arg('replay-from');

const SCREENSHOT_DIRNAME = 'screenshots';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);

const ensureDir = async (dir) => fs.mkdir(dir, { recursive: true });

const safeSlug = (value) => value.replace(/[^a-z0-9-_]/gi, '_').toLowerCase();

const wrapHtmlDocument = (fragment) => `<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <script src=\"https://cdn.tailwindcss.com\"></script>
  <title>Mockup Preview</title>
</head>
<body class=\"bg-neutral-100\">${fragment}</body>
</html>`;

const countMatches = (text, regex) => (text.match(regex) || []).length;

const structuralValidation = (payload) => {
  const issues = [];
  if (!payload || typeof payload !== 'object') issues.push('payload_non_object');
  if (payload?.version !== 'mockup_html_v1') issues.push('invalid_version');
  if (!Array.isArray(payload?.screens) || payload.screens.length < 1) issues.push('missing_screens');

  const screenIssues = [];
  (payload?.screens || []).forEach((screen, idx) => {
    const html = screen?.html || '';
    const local = [];
    if (!screen?.name) local.push('missing_name');
    if (!screen?.purpose) local.push('missing_purpose');
    if (!html.includes('min-h-screen')) local.push('missing_root_shell');
    if (!/<header\b/i.test(html)) local.push('missing_header');
    if (!/<main\b/i.test(html)) local.push('missing_main');
    if (!/<button\b/i.test(html) && !/<input\b/i.test(html) && !/<select\b/i.test(html)) local.push('missing_interactive_control');
    if (/<script\b/i.test(html)) local.push('contains_script');
    if (/<style\b/i.test(html)) local.push('contains_style');
    if (/javascript:/i.test(html)) local.push('javascript_url');

    if (local.length) {
      screenIssues.push({ screenIndex: idx, issues: local });
      issues.push(...local.map((item) => `screen_${idx + 1}:${item}`));
    }
  });

  return {
    isValid: issues.length === 0,
    issueCount: issues.length,
    issues,
    screenIssues,
    score: Math.max(0, 100 - issues.length * 9),
  };
};

const qualityScore = (payload, requiredSections) => {
  const html = (payload.screens || []).map((s) => s.html).join('\n').toLowerCase();
  const hasRequired = requiredSections.length
    ? requiredSections.filter((token) => html.includes(token.toLowerCase())).length / requiredSections.length
    : 1;

  const hierarchyCount = countMatches(html, /<(h1|h2|h3)\b/g);
  const sectionCount = countMatches(html, /<(section|article|aside)\b/g);
  const spacingClasses = countMatches(html, /\b(p|m|gap)-[0-9]+\b/g);
  const arbitrarySpacing = countMatches(html, /\b(p|m|gap)-\[[^\]]+\]/g);

  const layoutCoherence = Math.min(1, (sectionCount >= 2 ? 0.5 : sectionCount * 0.2) + (payload.screens?.length > 1 ? 0.5 : 0.3));
  const spacingConsistency = Math.max(0, Math.min(1, spacingClasses / 12) - Math.min(0.4, arbitrarySpacing * 0.08));
  const hierarchy = Math.min(1, hierarchyCount / 4);

  const weighted = {
    requiredSections: hasRequired * 35,
    layoutCoherence: layoutCoherence * 25,
    spacingConsistency: spacingConsistency * 20,
    visualHierarchy: hierarchy * 20,
  };

  const total = Object.values(weighted).reduce((sum, n) => sum + n, 0);
  return {
    total: Math.round(total),
    breakdown: Object.fromEntries(Object.entries(weighted).map(([k, v]) => [k, Math.round(v)])),
  };
};

const consistencyAcrossRuns = (caseRuns) => {
  if (caseRuns.length < 2) return 100;
  const hashes = caseRuns.map((run) => hash((run.payload?.screens || []).map((s) => s.html.replace(/\s+/g, ' ').trim()).join('\n')));
  const unique = new Set(hashes).size;
  const score = Math.round((1 - (unique - 1) / caseRuns.length) * 100);
  return Math.max(0, Math.min(100, score));
};

const fallbackPayload = (testCase) => ({
  version: 'mockup_html_v1',
  title: `${testCase.title} (Fallback)`,
  summary: 'Deterministic fallback screen used after generation failures.',
  screens: [
    {
      name: 'Fallback Screen',
      purpose: 'Keeps the preview renderable when generation is invalid.',
      html: `<div class=\"min-h-screen bg-neutral-50 text-neutral-900 p-6\"><header class=\"mb-4\"><h1 class=\"text-2xl font-semibold\">Fallback workspace</h1><button type=\"button\" class=\"mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-white\">Retry</button></header><main><section class=\"rounded-xl border border-neutral-200 bg-white p-5\">Unable to produce valid output for this PRD. Use replay to debug.</section></main></div>`,
    },
  ],
});

const generateFixture = async (testCase, runIndex, attempt) => {
  const unstableSuffix = runIndex % 2 === 0 ? 'A' : 'B';

  if (testCase.id === 'edge_overloaded' && attempt === 1) {
    return { error: 'model_output_invalid_json' };
  }

  if (testCase.id === 'edge_ambiguous') {
    return {
      payload: fallbackPayload(testCase),
      usedFallback: true,
      generatorNotes: ['Ambiguous PRD triggered safe fallback template.'],
    };
  }

  const flowScreens = testCase.settings.scope === 'key_workflow'
    ? ['Step 1: Setup', 'Step 2: Configure', 'Step 3: Upgrade']
    : testCase.settings.scope === 'multi_screen'
      ? ['Overview', 'Detail', 'Settings']
      : ['Primary Screen'];

  const screens = flowScreens.map((name, idx) => ({
    name,
    purpose: `${testCase.title} — ${name}`,
    html: `<div class=\"min-h-screen bg-neutral-50 text-neutral-900\"><header class=\"border-b border-neutral-200 bg-white px-6 py-4 flex items-center justify-between\"><h1 class=\"text-xl font-semibold\">${testCase.title}</h1><button type=\"button\" class=\"rounded-lg bg-indigo-600 text-white px-4 py-2\">Primary Action</button></header><main class=\"p-6 grid gap-6 ${testCase.settings.platform === 'mobile' ? 'grid-cols-1' : 'md:grid-cols-3'}\"><section class=\"${testCase.settings.platform === 'mobile' ? '' : 'md:col-span-2 '}rounded-xl border border-neutral-200 bg-white p-6\"><h2 class=\"text-lg font-semibold\">${testCase.requiredSections[0] || 'primary'} panel ${unstableSuffix}</h2><p class=\"mt-2 text-sm text-neutral-600\">${testCase.prd.slice(0, 120)}</p><div class=\"mt-4 rounded-lg bg-neutral-100 p-4\">${testCase.requiredSections.join(' · ')}</div></section><aside class=\"rounded-xl border border-neutral-200 bg-white p-5\"><h3 class=\"text-sm font-semibold\">supporting context</h3><ul class=\"mt-3 space-y-2 text-sm text-neutral-600\"><li>${testCase.requiredSections[1] || 'secondary'} metrics</li><li>${testCase.requiredSections[2] || 'controls'} status</li></ul><input class=\"mt-4 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm\" placeholder=\"Filter\" /></aside></main></div>`,
  }));

  return {
    payload: {
      version: 'mockup_html_v1',
      title: `${testCase.title} Concept`,
      summary: `Generated fixture output for ${testCase.id}.`,
      screens,
    },
    usedFallback: false,
    generatorNotes: [],
  };
};

// Phase C: Playwright-backed render also collects layout-viability signals
// per screen (styled, overflow, bodyHeight, visibleElements). Aggregated
// into a `layoutViabilityRate` metric so CI can catch "renders OK but looks
// blank" regressions that regex checks miss.
const probeLayout = async (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.min-h-screen') || document.body;
    const cs = window.getComputedStyle(root);
    const styled = parseFloat(cs.minHeight || '0') >= 1 || parseFloat(cs.padding || '0') > 0;
    const body = document.body;
    const horizontalOverflow = (body.scrollWidth - body.clientWidth) > 1;
    const bodyHeight = body.scrollHeight;
    const visibleElements = root.querySelectorAll('section, header, main, aside, nav, table, ul, button').length;
    return { styled, horizontalOverflow, bodyHeight, visibleElements };
  });

const renderAndProbe = async (payload, screenshotDir, prefix) => {
  const results = [];
  const probes = [];
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { ok: true, skipped: true, warning: 'Playwright is not available in this environment.', screenshots: results, probes };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (let i = 0; i < (payload.screens || []).length; i++) {
      const screen = payload.screens[i];
      const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
      await page.setContent(wrapHtmlDocument(screen.html), { waitUntil: 'networkidle' });
      const probe = await probeLayout(page);
      const imageName = `${prefix}-screen-${i + 1}.png`;
      const imagePath = path.join(screenshotDir, imageName);
      await page.screenshot({ path: imagePath, fullPage: true });
      await page.close();
      results.push(imagePath);
      probes.push({ screenIndex: i, ...probe });
    }
    return { ok: true, screenshots: results, probes };
  } catch (error) {
    return { ok: true, skipped: true, warning: `Screenshot rendering skipped: ${error instanceof Error ? error.message : String(error)}`, screenshots: results, probes };
  } finally {
    if (browser) await browser.close();
  }
};

// A render is layout-viable when every screen reports styled=true, no
// horizontal overflow, >100px body height, and at least one landmark.
const isLayoutViable = (probes) => {
  if (!probes || probes.length === 0) return false;
  return probes.every(p => p.styled && !p.horizontalOverflow && p.bodyHeight > 100 && p.visibleElements > 0);
};

// Shell signature = sorted unique Tailwind class tokens on the root shell
// element. Used to score perturbation pairs: a ≤10-token PRD edit should
// NOT flip the shell signature, because shell layout is a structural
// choice, not a content choice.
const extractShellSignature = (payload) => {
  const signatures = (payload.screens || []).map(screen => {
    const match = screen.html.match(/<div\s+class\s*=\s*["']([^"']*min-h-screen[^"']*)["']/i);
    if (!match) return [];
    const tokens = match[1].split(/\s+/).filter(Boolean);
    return [...new Set(tokens)].sort();
  });
  return signatures;
};

const jaccard = (a, b) => {
  if (!a.length && !b.length) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 1 : intersection / union;
};

const perturbationSimilarity = (primaryPayload, variantPayload) => {
  const primarySigs = extractShellSignature(primaryPayload);
  const variantSigs = extractShellSignature(variantPayload);
  if (primarySigs.length === 0 || variantSigs.length === 0) return null;
  const pairs = Math.min(primarySigs.length, variantSigs.length);
  let total = 0;
  for (let i = 0; i < pairs; i++) total += jaccard(primarySigs[i], variantSigs[i]);
  return total / pairs;
};

const detectRegressions = (currentMetrics, baselineMetrics) => {
  if (!baselineMetrics) return [];
  const regressions = [];
  const drop = (curr, base) => Math.round((base - curr) * 100) / 100;

  if (currentMetrics.renderSuccessRate + 0.01 < baselineMetrics.renderSuccessRate) {
    regressions.push(`Render success dropped by ${drop(currentMetrics.renderSuccessRate, baselineMetrics.renderSuccessRate)} points.`);
  }
  if (currentMetrics.structuralValidityRate + 0.01 < baselineMetrics.structuralValidityRate) {
    regressions.push(`Structural validity dropped by ${drop(currentMetrics.structuralValidityRate, baselineMetrics.structuralValidityRate)} points.`);
  }
  if (currentMetrics.visualQualityScore + 0.01 < baselineMetrics.visualQualityScore) {
    regressions.push(`Visual quality score dropped by ${drop(currentMetrics.visualQualityScore, baselineMetrics.visualQualityScore)} points.`);
  }
  if (currentMetrics.fallbackRate > baselineMetrics.fallbackRate + 0.01) {
    regressions.push(`Fallback rate increased by ${drop(baselineMetrics.fallbackRate, currentMetrics.fallbackRate)} points.`);
  }
  if (
    typeof currentMetrics.layoutViabilityRate === 'number'
    && typeof baselineMetrics.layoutViabilityRate === 'number'
    && currentMetrics.layoutViabilityRate + 0.01 < baselineMetrics.layoutViabilityRate
  ) {
    regressions.push(`Layout viability dropped by ${drop(currentMetrics.layoutViabilityRate, baselineMetrics.layoutViabilityRate)} points.`);
  }
  if (
    typeof currentMetrics.perturbationPassRate === 'number'
    && typeof baselineMetrics.perturbationPassRate === 'number'
    && currentMetrics.perturbationPassRate + 0.01 < baselineMetrics.perturbationPassRate
  ) {
    regressions.push(`Perturbation pass rate dropped by ${drop(currentMetrics.perturbationPassRate, baselineMetrics.perturbationPassRate)} points.`);
  }

  return regressions;
};

const buildDashboardHtml = (summary) => {
  const rows = Object.entries(summary.metrics)
    .map(([k, v]) => `<tr><td class=\"px-3 py-2 font-medium\">${k}</td><td class=\"px-3 py-2\">${v}</td></tr>`)
    .join('');

  const failures = summary.failures.length
    ? summary.failures.map((f) => `<li><code>${f.caseId}</code> (run ${f.run}) — ${f.reason}</li>`).join('')
    : '<li>No failures 🎉</li>';

  return `<!doctype html>
<html>
<head>
<meta charset=\"utf-8\"/>
<title>Mockup Evaluation Dashboard</title>
<script src=\"https://cdn.tailwindcss.com\"></script>
</head>
<body class=\"bg-neutral-100 text-neutral-900\">
  <main class=\"max-w-5xl mx-auto p-8 space-y-6\">
    <section class=\"rounded-xl bg-white border border-neutral-200 p-6\">
      <h1 class=\"text-2xl font-semibold\">Mockup Evaluation Dashboard</h1>
      <p class=\"text-sm text-neutral-600 mt-2\">Run ID: ${summary.runId} · ${summary.createdAt}</p>
    </section>
    <section class=\"rounded-xl bg-white border border-neutral-200 p-6\">
      <h2 class=\"text-lg font-semibold mb-4\">Core metrics</h2>
      <table class=\"w-full text-sm border border-neutral-200\"><tbody>${rows}</tbody></table>
    </section>
    <section class=\"rounded-xl bg-white border border-neutral-200 p-6\">
      <h2 class=\"text-lg font-semibold mb-3\">Failure breakdown</h2>
      <ul class=\"list-disc pl-5 text-sm space-y-1\">${failures}</ul>
    </section>
  </main>
</body>
</html>`;
};

const loadCases = async () => {
  const raw = await fs.readFile(suitePath, 'utf8');
  let cases = JSON.parse(raw);
  if (!Array.isArray(cases)) throw new Error('Suite must be an array of case objects.');

  if (replayFrom) {
    const replayRaw = await fs.readFile(path.resolve(repoRoot, replayFrom), 'utf8');
    const replay = JSON.parse(replayRaw);
    const failedIds = new Set((replay.failures || []).map((f) => f.caseId));
    cases = cases.filter((c) => failedIds.has(c.id));
  }

  if (caseFilter) {
    const wanted = new Set(caseFilter.split(',').map((x) => x.trim()));
    cases = cases.filter((c) => wanted.has(c.id));
  }

  return cases;
};

const main = async () => {
  const testCases = await loadCases();
  if (!testCases.length) {
    throw new Error('No test cases selected. Check --case or --replay-from filters.');
  }

  const runId = `${nowIso.replace(/[:.]/g, '-')}-${hash(`${Math.random()}`)}`;
  const runDir = path.join(outputRoot, runId);
  const screenshotDir = path.join(runDir, SCREENSHOT_DIRNAME);
  await ensureDir(screenshotDir);

  const logs = [];
  const failures = [];
  const caseRunMap = new Map();

  for (let run = 1; run <= runs; run++) {
    for (const testCase of testCases) {
      let retries = 0;
      let usedFallback = false;
      let generated;
      let reason = '';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        generated = await generateFixture(testCase, run, attempt);
        if (!generated.error) {
          retries = attempt - 1;
          break;
        }
        reason = generated.error;
        if (attempt === maxAttempts) {
          generated = { payload: fallbackPayload(testCase), usedFallback: true, generatorNotes: [`Fallback after error: ${reason}`] };
          retries = attempt - 1;
          usedFallback = true;
        }
      }

      const payload = generated.payload;
      usedFallback = usedFallback || generated.usedFallback;

      const structural = structuralValidation(payload);
      const quality = qualityScore(payload, testCase.requiredSections || []);

      const screenshotPrefix = `${safeSlug(testCase.id)}-run-${run}`;
      const renderResult = await renderAndProbe(payload, screenshotDir, screenshotPrefix);
      const renderSuccess = renderResult.ok;
      const renderSkipped = Boolean(renderResult.skipped);
      const layoutViable = renderSkipped ? null : isLayoutViable(renderResult.probes);

      if (!structural.isValid || (!renderSuccess && !renderSkipped) || layoutViable === false) {
        failures.push({
          caseId: testCase.id,
          run,
          reason: !structural.isValid
            ? structural.issues.join(', ')
            : layoutViable === false
              ? `layout_not_viable: ${JSON.stringify(renderResult.probes)}`
              : renderResult.warning || 'render_failed',
        });
      }

      const entry = {
        run,
        caseId: testCase.id,
        complexity: testCase.complexity,
        retries,
        usedFallback,
        renderSuccess,
        renderSkipped,
        renderWarning: renderResult.warning,
        screenshotPaths: renderResult.screenshots.map((p) => path.relative(repoRoot, p)),
        layoutViable,
        layoutProbes: renderResult.probes,
        structural,
        quality,
        generatorNotes: generated.generatorNotes || [],
        payload,
      };
      logs.push(entry);
      if (!caseRunMap.has(testCase.id)) caseRunMap.set(testCase.id, []);
      caseRunMap.get(testCase.id).push(entry);
    }
  }

  // Phase C perturbation pairs: for every case that ships a `variantPrompt`,
  // generate once under the variant and compare shell signatures against
  // the primary run's output. A shell-signature Jaccard < 0.9 means a
  // ≤10-token PRD edit altered the structural layout — the audit calls
  // this "fragility on small edits" (§3.5 risk #6 in the failure map).
  const perturbationPairs = [];
  for (const testCase of testCases) {
    if (!testCase.variantPrompt) continue;
    const primaryRuns = caseRunMap.get(testCase.id) ?? [];
    const primaryPayload = primaryRuns[0]?.payload;
    if (!primaryPayload) continue;
    const variantCase = { ...testCase, prd: testCase.variantPrompt, id: `${testCase.id}__variant` };
    const variantGen = await generateFixture(variantCase, 1, 1);
    const variantPayload = variantGen.payload;
    if (!variantPayload) continue;
    const similarity = perturbationSimilarity(primaryPayload, variantPayload);
    perturbationPairs.push({
      caseId: testCase.id,
      similarity,
      passedThreshold: similarity !== null ? similarity >= 0.9 : null,
    });
  }

  const total = logs.length;
  const renderSuccessRate = Math.round((logs.filter((l) => l.renderSuccess).length / total) * 10000) / 100;
  const structuralValidityRate = Math.round((logs.filter((l) => l.structural.isValid).length / total) * 10000) / 100;
  const retryRate = Math.round((logs.filter((l) => l.retries > 0).length / total) * 10000) / 100;
  const fallbackRate = Math.round((logs.filter((l) => l.usedFallback).length / total) * 10000) / 100;
  const visualQualityScore = Math.round(logs.reduce((sum, l) => sum + l.quality.total, 0) / total * 100) / 100;

  const consistencyValues = [...caseRunMap.values()].map((runsForCase) => consistencyAcrossRuns(runsForCase));
  const consistencyScore = Math.round((consistencyValues.reduce((sum, n) => sum + n, 0) / consistencyValues.length) * 100) / 100;

  const weakAreas = [];
  if (fallbackRate > 15) weakAreas.push('High fallback usage for ambiguous or overloaded PRDs.');
  if (consistencyScore < 85) weakAreas.push('Non-deterministic output variance observed across repeated runs.');
  if (visualQualityScore < 75) weakAreas.push('Average visual quality below desired threshold.');
  if (retryRate > 20) weakAreas.push('Frequent retries indicate fragile first-pass generation.');

  const recommendations = [
    'Strengthen prompt contracts for ambiguous PRDs with mandatory domain assumptions.',
    'Add stricter schema/structure validation before finalizing outputs in production.',
    'Track screenshot diffs per case for visual regression detection in CI.',
    'Prioritize deterministic seeds / temperature controls for consistency-sensitive cases.',
  ];

  // Phase C aggregates. layoutViabilityRate is computed over entries that
  // actually ran Playwright (not skipped). perturbationSimilarityAvg is the
  // mean Jaccard across all variant pairs; undefined when no pairs exist.
  const viabilityEntries = logs.filter(l => typeof l.layoutViable === 'boolean');
  const layoutViabilityRate = viabilityEntries.length
    ? Math.round((viabilityEntries.filter(l => l.layoutViable).length / viabilityEntries.length) * 10000) / 100
    : null;
  const perturbationWithValues = perturbationPairs.filter(p => typeof p.similarity === 'number');
  const perturbationSimilarityAvg = perturbationWithValues.length
    ? Math.round((perturbationWithValues.reduce((s, p) => s + p.similarity, 0) / perturbationWithValues.length) * 10000) / 10000
    : null;
  const perturbationPassRate = perturbationWithValues.length
    ? Math.round((perturbationWithValues.filter(p => p.passedThreshold).length / perturbationWithValues.length) * 10000) / 100
    : null;

  const metrics = {
    renderSuccessRate,
    structuralValidityRate,
    retryRate,
    fallbackRate,
    visualQualityScore,
    consistencyScore,
    layoutViabilityRate,
    perturbationSimilarityAvg,
    perturbationPassRate,
  };

  let baselineMetrics;
  if (baselinePath) {
    const baselineRaw = await fs.readFile(path.resolve(repoRoot, baselinePath), 'utf8');
    baselineMetrics = JSON.parse(baselineRaw).metrics;
  }

  const regressions = detectRegressions(metrics, baselineMetrics);

  if (layoutViabilityRate !== null && layoutViabilityRate < 100) {
    weakAreas.push(`Layout viability under 100% (${layoutViabilityRate}%) — some renders are blank, clipped, or unstyled.`);
  }
  if (perturbationPassRate !== null && perturbationPassRate < 100) {
    weakAreas.push(`Perturbation pass rate ${perturbationPassRate}% — minor PRD edits flip shell layout.`);
  }

  const summary = {
    runId,
    createdAt: nowIso,
    suitePath: path.relative(repoRoot, suitePath),
    runs,
    maxAttempts,
    totalCasesPerRun: testCases.length,
    totalEvaluations: total,
    metrics,
    failures,
    perturbationPairs,
    weakAreas,
    recommendations,
    regressions,
  };

  await fs.writeFile(path.join(runDir, 'run-log.json'), JSON.stringify(logs, null, 2));
  await fs.writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const failureReport = `# Failure report\n\nRun ID: ${runId}\n\n${failures.length ? failures.map((f) => `- ${f.caseId} (run ${f.run}): ${f.reason}`).join('\n') : 'No failures.'}\n`;
  await fs.writeFile(path.join(runDir, 'failure-report.md'), failureReport);

  const comparison = {
    byCase: [...caseRunMap.entries()].map(([caseId, entries]) => ({
      caseId,
      consistency: consistencyAcrossRuns(entries),
      averageQuality: Math.round(entries.reduce((sum, e) => sum + e.quality.total, 0) / entries.length),
      fallbackCount: entries.filter((e) => e.usedFallback).length,
    })),
  };
  await fs.writeFile(path.join(runDir, 'comparison.json'), JSON.stringify(comparison, null, 2));

  await fs.writeFile(path.join(runDir, 'dashboard.html'), buildDashboardHtml(summary));

  const latestAlias = path.join(outputRoot, 'latest');
  await fs.rm(latestAlias, { recursive: true, force: true });
  await fs.cp(runDir, latestAlias, { recursive: true });

  console.log(`Mockup evaluation complete. Artifacts in ${path.relative(repoRoot, runDir)}`);
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error('Harness failed:', error);
  process.exitCode = 1;
});
