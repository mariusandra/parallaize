#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MAX_COMMITS_PER_BATCH = 18;
const DEFAULT_MAX_BATCH_CHARS = 7_500;
const DEFAULT_COMMIT_REFERENCE_LIMIT = 15;
const MAX_GIT_BUFFER_BYTES = 32 * 1024 * 1024;
const RECORD_SEPARATOR = 0x1e;

const AREA_RULES = [
  { prefix: "apps/control/", label: "Control plane and API" },
  { prefix: "apps/web/", label: "Web UI and browser sessions" },
  { prefix: "packages/shared/", label: "Shared types and helpers" },
  { prefix: ".github/", label: "GitHub Actions and CI" },
  { prefix: "scripts/", label: "Build and release tooling" },
  { prefix: "packaging/", label: "Debian packaging" },
  { prefix: "infra/", label: "Infrastructure and deployment" },
  { prefix: "tests/", label: "Test coverage" },
  { prefix: "docs/", label: "Documentation" },
  { prefix: "data/", label: "State and fixtures" },
];

const execFileAsync = promisify(execFile);

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cwd = resolve(process.cwd());
  const releaseVersion = normalizeRequiredString(args["release-version"] ?? args.version, "--release-version");
  const packageRelease = normalizePackageRelease(args["package-release"] ?? args.release ?? "1");
  const releaseTag = normalizeReleaseTag(args["release-tag"] ?? buildReleaseTag(releaseVersion, packageRelease));
  const outputPath = args.output ? resolve(cwd, args.output) : null;

  const result = await generateReleaseNotes({
    cwd,
    releaseVersion,
    packageRelease,
    releaseTag,
    previousTag: normalizeOptionalTag(args["previous-tag"]),
    githubRepository: normalizeOptionalString(args["github-repository"] ?? process.env.GITHUB_REPOSITORY),
    githubServerUrl: normalizeOptionalString(args["github-server-url"] ?? process.env.GITHUB_SERVER_URL) ?? "https://github.com",
    openaiApiKey: normalizeOptionalString(args["openai-api-key"] ?? process.env.OPENAI_API_KEY),
    openaiBaseUrl:
      normalizeOptionalString(args["openai-base-url"] ?? process.env.OPENAI_RELEASE_NOTES_BASE_URL ?? process.env.OPENAI_BASE_URL)
      ?? DEFAULT_BASE_URL,
    openaiModel:
      normalizeOptionalString(args["openai-model"] ?? process.env.OPENAI_RELEASE_NOTES_MODEL ?? process.env.OPENAI_MODEL)
      ?? DEFAULT_MODEL,
    maxCommitsPerBatch: parsePositiveInteger(args["max-commits-per-batch"], DEFAULT_MAX_COMMITS_PER_BATCH),
    maxBatchChars: parsePositiveInteger(args["max-batch-chars"], DEFAULT_MAX_BATCH_CHARS),
  });

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${result.body.trim()}\n`, "utf8");
    console.error(`Wrote ${result.mode} release notes to ${outputPath}.`);
  } else {
    process.stdout.write(`${result.body.trim()}\n`);
  }

  if (result.warning) {
    console.error(result.warning);
  }

  return result;
}

export async function generateReleaseNotes(options) {
  const changeSet = await collectReleaseChangeSet(options);
  const fallbackBody = formatFallbackReleaseNotes(changeSet);

  if (!options.openaiApiKey) {
    return {
      body: fallbackBody,
      mode: "fallback",
      warning: "OpenAI API key not configured. Release notes were generated from git metadata only.",
      changeSet,
    };
  }

  try {
    const batches = createCommitBatches(changeSet.commits, {
      maxCommitsPerBatch: options.maxCommitsPerBatch ?? DEFAULT_MAX_COMMITS_PER_BATCH,
      maxBatchChars: options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS,
    });

    const batchSummaries = [];

    for (const batch of batches) {
      const batchSummary = await generateBatchSummary({
        apiKey: options.openaiApiKey,
        baseUrl: options.openaiBaseUrl ?? DEFAULT_BASE_URL,
        model: options.openaiModel ?? DEFAULT_MODEL,
        changeSet,
        batch,
      });
      batchSummaries.push(batchSummary);
    }

    const generatedSections = await generateFinalSections({
      apiKey: options.openaiApiKey,
      baseUrl: options.openaiBaseUrl ?? DEFAULT_BASE_URL,
      model: options.openaiModel ?? DEFAULT_MODEL,
      changeSet,
      batchSummaries,
    });

    if (!looksLikeReleaseNotes(generatedSections)) {
      return {
        body: fallbackBody,
        mode: "fallback",
        warning: "OpenAI returned an unexpected release-note format. Fell back to deterministic notes.",
        changeSet,
      };
    }

    return {
      body: assembleReleaseNotes(generatedSections, changeSet),
      mode: "openai",
      warning: null,
      changeSet,
    };
  } catch (error) {
    return {
      body: fallbackBody,
      mode: "fallback",
      warning: `OpenAI release-note generation failed. Fell back to deterministic notes. ${formatErrorMessage(error)}`,
      changeSet,
    };
  }
}

export async function collectReleaseChangeSet(options) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const releaseTag = normalizeReleaseTag(options.releaseTag);
  const previousTag = options.previousTag ?? (await findPreviousReleaseTag(cwd, releaseTag));
  const diffBase = previousTag ?? EMPTY_TREE_SHA;
  const commits = await listCommits(cwd, previousTag);
  const changedFiles = await listChangedFiles(cwd, diffBase);
  const diffStats = await getDiffStats(cwd, diffBase);
  const fileChurn = await listFileChurn(cwd, diffBase);
  const topAreas = summarizeAreas(changedFiles.map((file) => file.path));
  const topFiles = summarizeTopFiles(fileChurn);
  const compareUrl = buildCompareUrl({
    githubRepository: options.githubRepository,
    githubServerUrl: options.githubServerUrl,
    previousTag,
    releaseTag,
  });

  return {
    releaseVersion: options.releaseVersion,
    packageRelease: normalizePackageRelease(options.packageRelease ?? "1"),
    releaseTag,
    previousTag,
    compareUrl,
    commits,
    diffStats,
    changedFiles,
    topAreas,
    topFiles,
  };
}

export async function findPreviousReleaseTag(cwd, releaseTag) {
  const tags = await listReleaseTags(cwd);
  return findPreviousReleaseTagFromList(tags, releaseTag);
}

export async function listReleaseTags(cwd) {
  const stdout = await runGitText(cwd, ["tag", "--list", "v*"]);
  return stdout
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter((tag) => parseReleaseTag(tag));
}

export function findPreviousReleaseTagFromList(tags, releaseTag) {
  const currentTag = parseReleaseTag(releaseTag);
  if (!currentTag) {
    throw new Error(`Unsupported release tag "${releaseTag}". Use tags like "v0.1.9" or "v0.1.9-2".`);
  }

  return tags
    .map(parseReleaseTag)
    .filter(Boolean)
    .filter((tag) => compareParsedReleaseTags(tag, currentTag) < 0)
    .sort(compareParsedReleaseTags)
    .at(-1)?.raw ?? null;
}

export function createCommitBatches(commits, limits = {}) {
  if (commits.length === 0) {
    return [
      {
        index: 1,
        total: 1,
        commits: [],
        promptText: "No commits found in the release range.",
      },
    ];
  }

  const maxCommitsPerBatch = limits.maxCommitsPerBatch ?? DEFAULT_MAX_COMMITS_PER_BATCH;
  const maxBatchChars = limits.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const batches = [];
  let currentCommits = [];
  let currentLength = 0;

  for (const commit of commits) {
    const entry = renderCommitBatchEntry(commit);
    const exceedsCount = currentCommits.length >= maxCommitsPerBatch;
    const exceedsChars = currentCommits.length > 0 && currentLength + entry.length + 2 > maxBatchChars;

    if (exceedsCount || exceedsChars) {
      batches.push(currentCommits);
      currentCommits = [];
      currentLength = 0;
    }

    currentCommits.push(commit);
    currentLength += entry.length + 2;
  }

  if (currentCommits.length > 0) {
    batches.push(currentCommits);
  }

  return batches.map((batchCommits, index) => ({
    index: index + 1,
    total: batches.length,
    commits: batchCommits,
    promptText: batchCommits.map(renderCommitBatchEntry).join("\n"),
  }));
}

export function formatFallbackReleaseNotes(changeSet) {
  const lines = [];
  const previousLabel = changeSet.previousTag ?? "the first tagged release";
  const topAreaLabels = changeSet.topAreas.slice(0, 3).map((area) => area.label);
  const topFileLabels = changeSet.topFiles
    .slice(0, 5)
    .map((file) => `\`${file.path}\` (${formatFileChurn(file)})`);

  lines.push("## Highlights");
  lines.push("- This release summary was assembled directly from git metadata.");
  lines.push(
    `- ${formatCount(changeSet.commits.length, "commit")} ${changeSet.commits.length === 1 ? "is" : "are"} included since ${previousLabel}.`,
  );
  lines.push(
    topAreaLabels.length > 0
      ? `- Main areas touched: ${joinHumanList(topAreaLabels)}.`
      : "- Main areas touched: repository-wide updates.",
  );
  lines.push("");
  lines.push("## Key Changes");

  if (topFileLabels.length > 0) {
    lines.push(`- Highest-churn files: ${joinHumanList(topFileLabels)}.`);
  } else {
    lines.push("- No file-level churn summary was available for this range.");
  }

  const recentCommits = changeSet.commits.slice(0, 5).map((commit) => `\`${commit.shortSha}\` ${commit.subject}`);
  if (recentCommits.length > 0) {
    lines.push(`- Recent commit subjects: ${joinHumanList(recentCommits)}.`);
  }

  lines.push("");
  lines.push("## Operator Notes");
  lines.push("- Review the full compare and package assets before rollout.");
  if (changeSet.packageRelease !== "1") {
    lines.push(`- This is package revision \`${changeSet.packageRelease}\` for release \`${changeSet.releaseVersion}\`.`);
  } else {
    lines.push("- This release publishes the default package revision for the resolved semver.");
  }
  lines.push("");
  lines.push("## Release Scope");

  for (const scopeLine of buildScopeLines(changeSet)) {
    lines.push(`- ${scopeLine}`);
  }

  if (changeSet.compareUrl) {
    lines.push("");
    lines.push("## Full Compare");
    lines.push(`- ${changeSet.compareUrl}`);
  }

  const commitReference = changeSet.commits.slice(0, DEFAULT_COMMIT_REFERENCE_LIMIT);
  if (commitReference.length > 0) {
    lines.push("");
    lines.push("## Commit Reference");
    for (const commit of commitReference) {
      lines.push(`- \`${commit.shortSha}\` ${commit.subject} (${commit.author}, ${commit.date})`);
    }

    const remainingCommitCount = changeSet.commits.length - commitReference.length;
    if (remainingCommitCount > 0) {
      lines.push(
        `- ${formatCount(remainingCommitCount, "additional commit")} ${remainingCommitCount === 1 ? "is" : "are"} included in the tagged range.`,
      );
    }
  }

  return lines.join("\n").trim();
}

export function assembleReleaseNotes(generatedSections, changeSet) {
  const lines = [generatedSections.trim(), "", "## Release Scope"];

  for (const scopeLine of buildScopeLines(changeSet)) {
    lines.push(`- ${scopeLine}`);
  }

  if (changeSet.compareUrl) {
    lines.push("");
    lines.push("## Full Compare");
    lines.push(`- ${changeSet.compareUrl}`);
  }

  return lines.join("\n").trim();
}

export function buildScopeLines(changeSet) {
  const scopeLines = [];
  const previousLabel = changeSet.previousTag ?? "repository start";
  const releaseDescriptor =
    changeSet.packageRelease === "1"
      ? `Release \`${changeSet.releaseTag}\``
      : `Release \`${changeSet.releaseTag}\` (package revision \`${changeSet.packageRelease}\`)`;

  scopeLines.push(`${releaseDescriptor} covers ${formatCount(changeSet.commits.length, "commit")} since ${previousLabel}.`);

  if (changeSet.diffStats.filesChanged > 0) {
    scopeLines.push(
      `${changeSet.diffStats.filesChanged} files changed with ${changeSet.diffStats.insertions} insertions and ${changeSet.diffStats.deletions} deletions.`,
    );
  } else if (changeSet.changedFiles.length > 0) {
    scopeLines.push(`${changeSet.changedFiles.length} files changed in the release diff.`);
  } else {
    scopeLines.push("No file-level diff statistics were available for the release range.");
  }

  if (changeSet.topAreas.length > 0) {
    scopeLines.push(`Primary areas: ${joinHumanList(changeSet.topAreas.slice(0, 4).map((area) => area.label))}.`);
  }

  const addedCount = changeSet.changedFiles.filter((file) => file.status === "A").length;
  const modifiedCount = changeSet.changedFiles.filter((file) => file.status === "M").length;
  const deletedCount = changeSet.changedFiles.filter((file) => file.status === "D").length;
  const renamedCount = changeSet.changedFiles.filter((file) => file.status.startsWith("R")).length;
  const changeCounts = [];

  if (addedCount > 0) {
    changeCounts.push(`${addedCount} added`);
  }
  if (modifiedCount > 0) {
    changeCounts.push(`${modifiedCount} modified`);
  }
  if (deletedCount > 0) {
    changeCounts.push(`${deletedCount} deleted`);
  }
  if (renamedCount > 0) {
    changeCounts.push(`${renamedCount} renamed`);
  }

  if (changeCounts.length > 0) {
    scopeLines.push(`File mix: ${joinHumanList(changeCounts)}.`);
  }

  return scopeLines;
}

export function parseReleaseTag(tag) {
  const match = /^v(?<version>\d+\.\d+\.\d+)(?:-(?<packageRelease>[1-9]\d*))?$/u.exec(tag);
  if (!match?.groups) {
    return null;
  }

  return {
    raw: tag,
    version: match.groups.version,
    packageRelease: Number.parseInt(match.groups.packageRelease ?? "1", 10),
  };
}

export function compareReleaseTags(leftTag, rightTag) {
  const left = parseReleaseTag(leftTag);
  const right = parseReleaseTag(rightTag);

  if (!left || !right) {
    throw new Error(`Cannot compare unsupported release tags "${leftTag}" and "${rightTag}".`);
  }

  return compareParsedReleaseTags(left, right);
}

export function extractResponseText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const outputs = Array.isArray(payload.output) ? payload.output : [];
  const segments = [];

  for (const item of outputs) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentPart of item.content) {
      if (contentPart?.type === "output_text" && typeof contentPart.text === "string") {
        segments.push(contentPart.text);
      }
    }
  }

  return segments.join("\n").trim();
}

async function listCommits(cwd, previousTag) {
  const gitArgs = [
    "--no-pager",
    "log",
    "--reverse",
    "-z",
    "--date=short",
    "--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ad",
    "--name-only",
    "--find-renames",
  ];

  if (previousTag) {
    gitArgs.push(`${previousTag}..HEAD`);
  } else {
    gitArgs.push("HEAD");
  }

  const stdout = await runGitBuffer(cwd, gitArgs);
  return parseCommitLogBuffer(stdout);
}

function parseCommitLogBuffer(buffer) {
  const commits = [];

  for (const record of splitBuffer(buffer, RECORD_SEPARATOR)) {
    if (record.length === 0) {
      continue;
    }

    const firstNullIndex = record.indexOf(0);
    const headerBuffer = firstNullIndex >= 0 ? record.subarray(0, firstNullIndex) : record;
    const fileBuffer = firstNullIndex >= 0 ? record.subarray(firstNullIndex + 1) : Buffer.alloc(0);
    const headerText = headerBuffer.toString("utf8").trim();

    if (!headerText) {
      continue;
    }

    const [sha, shortSha, subject, author, date] = headerText.split("\x1f");
    const files = fileBuffer
      .toString("utf8")
      .split("\0")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const uniqueFiles = [...new Set(files)];

    commits.push({
      sha,
      shortSha,
      subject,
      author,
      date,
      files: uniqueFiles,
      areas: summarizeAreas(uniqueFiles).map((area) => area.label),
    });
  }

  return commits;
}

async function listChangedFiles(cwd, diffBase) {
  const stdout = await runGitText(cwd, ["diff", "--name-status", "--find-renames", diffBase, "HEAD"]);
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNameStatusLine)
    .filter(Boolean);
}

async function getDiffStats(cwd, diffBase) {
  const stdout = (await runGitText(cwd, ["diff", "--shortstat", diffBase, "HEAD"])).trim();
  const filesChanged = Number.parseInt(/(\d+)\s+files?\s+changed/u.exec(stdout)?.[1] ?? "0", 10);
  const insertions = Number.parseInt(/(\d+)\s+insertions?\(\+\)/u.exec(stdout)?.[1] ?? "0", 10);
  const deletions = Number.parseInt(/(\d+)\s+deletions?\(-\)/u.exec(stdout)?.[1] ?? "0", 10);

  return {
    filesChanged,
    insertions,
    deletions,
  };
}

async function listFileChurn(cwd, diffBase) {
  const stdout = await runGitText(cwd, ["diff", "--numstat", diffBase, "HEAD"]);

  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [addedRaw, deletedRaw, path] = line.split("\t");
      const additions = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10);
      const deletions = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10);

      return {
        path,
        additions,
        deletions,
        churn: additions + deletions,
      };
    })
    .filter((entry) => entry.path);
}

function summarizeAreas(files) {
  const counts = new Map();

  for (const file of files) {
    const area = classifyArea(file);
    const existing = counts.get(area.label) ?? { label: area.label, fileCount: 0, churn: 0 };
    existing.fileCount += 1;
    existing.churn += area.weight;
    counts.set(area.label, existing);
  }

  return [...counts.values()].sort((left, right) => {
    if (right.fileCount !== left.fileCount) {
      return right.fileCount - left.fileCount;
    }
    if (right.churn !== left.churn) {
      return right.churn - left.churn;
    }
    return left.label.localeCompare(right.label);
  });
}

function summarizeTopFiles(fileChurn) {
  return [...fileChurn]
    .sort((left, right) => {
      if (right.churn !== left.churn) {
        return right.churn - left.churn;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, 12);
}

function classifyArea(filePath) {
  for (const rule of AREA_RULES) {
    if (filePath.startsWith(rule.prefix)) {
      return {
        label: rule.label,
        weight: 2,
      };
    }
  }

  const [topLevel = "Repository root"] = filePath.split("/", 1);
  return {
    label: topLevel === "Repository root" ? topLevel : `${topLevel} updates`,
    weight: 1,
  };
}

function parseNameStatusLine(line) {
  const parts = line.split("\t");
  if (parts.length < 2) {
    return null;
  }

  const status = parts[0];
  if (status.startsWith("R") || status.startsWith("C")) {
    return {
      status,
      previousPath: parts[1],
      path: parts[2],
    };
  }

  return {
    status,
    previousPath: null,
    path: parts[1],
  };
}

async function generateBatchSummary({ apiKey, baseUrl, model, changeSet, batch }) {
  const input = buildBatchPrompt(changeSet, batch);
  return requestOpenAIText({
    apiKey,
    baseUrl,
    model,
    instructions:
      "Summarize technical release changes into short factual markdown bullets. Avoid hype, do not invent behavior, and ignore release bookkeeping.",
    input,
    maxOutputTokens: 900,
  });
}

async function generateFinalSections({ apiKey, baseUrl, model, changeSet, batchSummaries }) {
  const input = buildFinalPrompt(changeSet, batchSummaries);
  return requestOpenAIText({
    apiKey,
    baseUrl,
    model,
    instructions:
      "Write concise GitHub release descriptions for infrastructure-heavy software projects. Return markdown only, use the requested section headings exactly, and keep the tone factual.",
    input,
    maxOutputTokens: 1_400,
  });
}

async function requestOpenAIText({ apiKey, baseUrl, model, instructions, input, maxOutputTokens }) {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: input,
            },
          ],
        },
      ],
      max_output_tokens: maxOutputTokens,
      store: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorText.slice(0, 500)}`);
  }

  const payload = await response.json();
  const outputText = extractResponseText(payload);

  if (!outputText) {
    throw new Error("OpenAI API response did not contain any output text.");
  }

  return outputText.trim();
}

function buildBatchPrompt(changeSet, batch) {
  return [
    `Project: Parallaize`,
    `Release tag: ${changeSet.releaseTag}`,
    `Release version: ${changeSet.releaseVersion}`,
    `Previous tag: ${changeSet.previousTag ?? "none (initial tagged release)"}`,
    `Package release: ${changeSet.packageRelease}`,
    "",
    "Global release scope:",
    ...buildScopeLines(changeSet).map((line) => `- ${line}`),
    "",
    `Batch ${batch.index} of ${batch.total}:`,
    batch.promptText,
    "",
    "Write 4-6 markdown bullets for this batch.",
    "- Focus on concrete shipped changes, not process commentary.",
    "- Mention operator, packaging, networking, CI, and UI effects when clearly present.",
    "- Ignore pure release-version bookkeeping.",
    "- Do not mention commit counts or compare links.",
  ].join("\n");
}

function buildFinalPrompt(changeSet, batchSummaries) {
  const topFiles = changeSet.topFiles.slice(0, 8).map((file) => `- ${file.path} (${formatFileChurn(file)})`).join("\n");
  const areas = changeSet.topAreas.slice(0, 6).map((area) => `- ${area.label}: ${area.fileCount} files`).join("\n");

  return [
    `Project: Parallaize`,
    `Release tag: ${changeSet.releaseTag}`,
    `Release version: ${changeSet.releaseVersion}`,
    `Previous tag: ${changeSet.previousTag ?? "none (initial tagged release)"}`,
    `Package release: ${changeSet.packageRelease}`,
    "",
    "Release scope:",
    ...buildScopeLines(changeSet).map((line) => `- ${line}`),
    "",
    "Top changed areas:",
    areas || "- No area summary available.",
    "",
    "Top changed files by churn:",
    topFiles || "- No file churn data available.",
    "",
    "Batch summaries:",
    ...batchSummaries.flatMap((summary, index) => [`### Batch ${index + 1}`, summary.trim(), ""]),
    "Return markdown only with exactly these sections:",
    "## Highlights",
    "- 3-5 bullets with the most important release outcomes.",
    "## Key Changes",
    "### Use 2-4 short subsection headings grouped by theme.",
    "- Use flat bullets under each subsection.",
    "## Operator Notes",
    "- 1-3 bullets, or a single bullet saying `None.` when nothing operator-facing stands out.",
    "",
    "Constraints:",
    "- Keep the full response under roughly 350 words.",
    "- Prefer externally relevant behavior and deployment impact over internal mechanics.",
    "- Treat tests and docs as supporting evidence unless they are a major release theme.",
    "- Do not add a title, scope section, compare link, or asset list.",
  ].join("\n");
}

function renderCommitBatchEntry(commit) {
  const areaText = commit.areas.length > 0 ? ` | areas: ${joinHumanList(commit.areas.slice(0, 3))}` : "";
  const fileText =
    commit.files.length > 0
      ? ` | files: ${formatFileList(commit.files, 6)}`
      : "";
  return `- ${commit.shortSha} ${commit.subject} (${commit.author}, ${commit.date})${areaText}${fileText}`;
}

function formatFileList(files, limit) {
  const visibleFiles = files.slice(0, limit);
  const remainingCount = files.length - visibleFiles.length;
  const renderedFiles = visibleFiles.map((file) => `\`${file}\``);

  if (remainingCount > 0) {
    renderedFiles.push(`${remainingCount} more`);
  }

  return renderedFiles.join(", ");
}

function looksLikeReleaseNotes(text) {
  return /^## Highlights\b[\s\S]+^## Key Changes\b[\s\S]+^## Operator Notes\b/mu.test(text.trim());
}

function buildCompareUrl({ githubRepository, githubServerUrl, previousTag, releaseTag }) {
  if (!githubRepository || !previousTag || !releaseTag) {
    return null;
  }

  const normalizedServerUrl = (githubServerUrl ?? "https://github.com").replace(/\/+$/u, "");
  return `${normalizedServerUrl}/${githubRepository}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(releaseTag)}`;
}

function buildReleaseTag(version, packageRelease) {
  return packageRelease === "1" ? `v${version}` : `v${version}-${packageRelease}`;
}

function normalizeReleaseTag(tag) {
  const normalizedTag = normalizeRequiredString(tag, "--release-tag");
  if (!parseReleaseTag(normalizedTag)) {
    throw new Error(`Unsupported release tag "${tag}". Use tags like "v0.1.9" or "v0.1.9-2".`);
  }
  return normalizedTag;
}

function normalizePackageRelease(value) {
  const normalizedValue = normalizeRequiredString(value, "--package-release");
  if (!/^[1-9]\d*$/u.test(normalizedValue)) {
    throw new Error(`Unsupported package release "${value}". Use a positive integer like "1".`);
  }
  return normalizedValue;
}

function normalizeRequiredString(value, flagName) {
  const normalizedValue = String(value ?? "").trim();
  if (!normalizedValue) {
    throw new Error(`Missing required ${flagName} value.`);
  }
  return normalizedValue;
}

function normalizeOptionalTag(value) {
  const normalizedValue = normalizeOptionalString(value);
  if (!normalizedValue) {
    return null;
  }
  return normalizeReleaseTag(normalizedValue);
}

function normalizeOptionalString(value) {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || null;
}

function parseArgs(argv) {
  const parsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const withoutPrefix = current.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");

    if (equalsIndex >= 0) {
      parsedArgs[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      parsedArgs[withoutPrefix] = nextValue;
      index += 1;
      continue;
    }

    parsedArgs[withoutPrefix] = "true";
  }

  return parsedArgs;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Expected a positive integer but received "${value}".`);
  }

  return parsedValue;
}

function compareParsedReleaseTags(left, right) {
  const leftVersionParts = left.version.split(".").map((part) => Number.parseInt(part, 10));
  const rightVersionParts = right.version.split(".").map((part) => Number.parseInt(part, 10));

  for (let index = 0; index < 3; index += 1) {
    if (leftVersionParts[index] !== rightVersionParts[index]) {
      return leftVersionParts[index] - rightVersionParts[index];
    }
  }

  return left.packageRelease - right.packageRelease;
}

function joinHumanList(values) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function formatFileChurn(file) {
  return `+${file.additions}/-${file.deletions}`;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

async function runGitText(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: MAX_GIT_BUFFER_BYTES,
  });
  return String(stdout);
}

async function runGitBuffer(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "buffer",
    maxBuffer: MAX_GIT_BUFFER_BYTES,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

function splitBuffer(buffer, separatorByte) {
  const parts = [];
  let startIndex = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== separatorByte) {
      continue;
    }

    parts.push(buffer.subarray(startIndex, index));
    startIndex = index + 1;
  }

  parts.push(buffer.subarray(startIndex));
  return parts;
}

function isDirectExecution(moduleUrl, argv1) {
  if (!argv1) {
    return false;
  }

  return moduleUrl === pathToFileURL(resolve(argv1)).href;
}
