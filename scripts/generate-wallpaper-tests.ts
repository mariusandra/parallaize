import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildAllWallpaperSubjects,
  buildBulkWallpaperFilename,
  collectPendingWallpaperSubjects,
} from "../packages/shared/src/wallpaper-catalog.js";
import { slugify } from "../packages/shared/src/helpers.js";
import {
  buildCompressionFriendlyWallpaperPrompt,
  buildRandomWallpaperSubject,
  buildWallpaperSubjectFromParts,
  DEFAULT_WALLPAPER_MODEL,
  DEFAULT_WALLPAPER_OUTPUT_COMPRESSION,
  DEFAULT_WALLPAPER_OUTPUT_FORMAT,
  DEFAULT_WALLPAPER_QUALITY,
  DEFAULT_WALLPAPER_SIZE,
  type WallpaperOutputFormat,
  type WallpaperQuality,
  type WallpaperSubject,
} from "../packages/shared/src/wallpaper-prompts.js";
import {
  pickRandomWord,
  vmNameAdjectives,
  vmNameAnimals,
  type VmNameAdjective,
  type VmNameAnimal,
} from "../packages/shared/src/vm-name-words.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_SINGLE_OUTPUT_DIR = "artifacts/wallpaper-tests";
const DEFAULT_BULK_OUTPUT_DIR = "artifacts/wallpapers/24.04";
const BULK_MANIFEST_FILENAME = "manifest.json";
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_VARIANTS = 1;
const DEFAULT_BULK_CONCURRENCY = 10;
const MAX_RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BASE_DELAY_MS = 2_000;
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

interface ParsedArgs {
  adjective?: string;
  all?: string;
  animal?: string;
  baseUrl?: string;
  dryRun?: string;
  model?: string;
  outputCompression?: string;
  outputDir?: string;
  outputFormat?: string;
  size?: string;
  variants?: string;
}

interface OpenAiImageData {
  b64_json?: string;
  revised_prompt?: string;
}

interface OpenAiImageResponse {
  data?: OpenAiImageData[];
}

interface RunManifest {
  createdAt: string;
  dryRun: boolean;
  model: string;
  outputCompression: number | null;
  outputFormat: WallpaperOutputFormat;
  outputSize: string;
  prompt: string;
  quality: WallpaperQuality;
  subject: WallpaperSubject;
  variants: number;
  outputs: Array<{
    filename: string;
    path: string;
    quality: WallpaperQuality;
    revisedPrompt: string | null;
    variant: number;
  }>;
}

interface BulkManifest {
  completedCount: number;
  concurrency: number;
  createdAt: string;
  dryRun: boolean;
  error: BulkRunErrorSummary | null;
  lastCompletedSlug: string | null;
  model: string;
  nextSlug: string | null;
  outputCompression: number | null;
  outputFormat: WallpaperOutputFormat;
  outputSize: string;
  quality: WallpaperQuality;
  remainingCount: number;
  skippedExistingCount: number;
  status: "completed" | "dry-run" | "failed" | "paused_quota" | "running";
  totalCount: number;
  updatedAt: string;
}

interface BulkRunErrorSummary {
  code: string | null;
  message: string;
  requestId: string | null;
  status: number | null;
  type: string | null;
}

interface GeneratorOptions {
  apiKey: string | null;
  baseUrl: string;
  dryRun: boolean;
  model: string;
  outputCompression: number | null;
  outputFormat: WallpaperOutputFormat;
  outputSize: string;
  quality: WallpaperQuality;
}

class OpenAiApiError extends Error {
  code: string | null;
  requestId: string | null;
  status: number | null;
  type: string | null;

  constructor(
    message: string,
    details: {
      code?: string | null;
      requestId?: string | null;
      status?: number | null;
      type?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "OpenAiApiError";
    this.code = details.code ?? null;
    this.requestId = details.requestId ?? null;
    this.status = details.status ?? null;
    this.type = details.type ?? null;
  }
}

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
  const options = resolveGeneratorOptions(args);

  if (args.all === "true") {
    return runBulkGeneration(options, args);
  }

  return runSingleGeneration(options, args);
}

async function runSingleGeneration(
  options: GeneratorOptions,
  args: ParsedArgs,
): Promise<RunManifest> {
  const subject = parseSubject(args);
  const outputRoot = resolve(
    process.cwd(),
    normalizeOptionalString(args.outputDir) ?? DEFAULT_SINGLE_OUTPUT_DIR,
  );
  const runDirectory = resolve(
    outputRoot,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${subject.slug}`,
  );
  const prompt = buildCompressionFriendlyWallpaperPrompt({ subject });

  assertApiKeyPresent(options.apiKey, options.dryRun);
  const resolvedApiKey = options.apiKey ?? "";

  await mkdir(runDirectory, { recursive: true });
  await writeFile(resolve(runDirectory, "prompt.txt"), `${prompt}\n`, "utf8");

  const manifest: RunManifest = {
    createdAt: new Date().toISOString(),
    dryRun: options.dryRun,
    model: options.model,
    outputCompression: options.outputCompression,
    outputFormat: options.outputFormat,
    outputSize: options.outputSize,
    prompt,
    quality: options.quality,
    subject,
    variants: parsePositiveInteger(args.variants, DEFAULT_VARIANTS),
    outputs: [],
  };

  console.error(`Preparing wallpaper tests for ${subject.slug} at ${runDirectory}`);

  if (options.dryRun) {
    await writeSingleManifest(runDirectory, manifest);
    console.error("Dry run only. Prompt and manifest were written without calling OpenAI.");
    return manifest;
  }

  for (let variant = 1; variant <= manifest.variants; variant += 1) {
    console.error(
      `Generating ${options.quality} quality variant ${variant}/${manifest.variants}`,
    );
    const imageBytes = await generateWallpaperWithRetries({
      apiKey: resolvedApiKey,
      baseUrl: options.baseUrl,
      model: options.model,
      outputCompression: options.outputCompression,
      outputFormat: options.outputFormat,
      outputSize: options.outputSize,
      prompt,
      quality: options.quality,
    });
    const filename = buildSingleOutputFilename(
      subject.slug,
      options.outputSize,
      options.outputFormat,
      variant,
    );
    const outputPath = resolve(runDirectory, filename);
    await writeFile(outputPath, imageBytes.bytes);
    manifest.outputs.push({
      filename,
      path: outputPath,
      quality: options.quality,
      revisedPrompt: imageBytes.revisedPrompt,
      variant,
    });
  }

  await writeSingleManifest(runDirectory, manifest);
  console.error(
    `Wrote ${manifest.outputs.length} wallpaper${manifest.outputs.length === 1 ? "" : "s"} to ${runDirectory}`,
  );
  return manifest;
}

async function runBulkGeneration(
  options: GeneratorOptions,
  args: ParsedArgs,
): Promise<BulkManifest> {
  assertApiKeyPresent(options.apiKey, options.dryRun);
  const resolvedApiKey = options.apiKey ?? "";
  const outputRoot = resolve(
    process.cwd(),
    normalizeOptionalString(args.outputDir) ?? DEFAULT_BULK_OUTPUT_DIR,
  );

  await mkdir(outputRoot, { recursive: true });

  const allSubjects = buildAllWallpaperSubjects();
  const existingFilenames = await listExistingFilenames(outputRoot);
  const pendingSubjects = collectPendingWallpaperSubjects(
    allSubjects,
    existingFilenames,
    options.outputFormat,
  );
  const skippedExistingCount = allSubjects.length - pendingSubjects.length;

  const manifest: BulkManifest = {
    completedCount: skippedExistingCount,
    concurrency: DEFAULT_BULK_CONCURRENCY,
    createdAt: new Date().toISOString(),
    dryRun: options.dryRun,
    error: null,
    lastCompletedSlug: null,
    model: options.model,
    nextSlug: pendingSubjects[0]?.slug ?? null,
    outputCompression: options.outputCompression,
    outputFormat: options.outputFormat,
    outputSize: options.outputSize,
    quality: options.quality,
    remainingCount: pendingSubjects.length,
    skippedExistingCount,
    status: options.dryRun ? "dry-run" : "running",
    totalCount: allSubjects.length,
    updatedAt: new Date().toISOString(),
  };

  await writeBulkManifest(outputRoot, manifest);

  if (options.dryRun) {
    console.error(
      `Dry run only. ${pendingSubjects.length} wallpaper${pendingSubjects.length === 1 ? "" : "s"} pending in ${outputRoot}.`,
    );
    return manifest;
  }

  console.error(
    `Bulk wallpaper generation: ${pendingSubjects.length}/${allSubjects.length} remaining in ${outputRoot} with concurrency ${DEFAULT_BULK_CONCURRENCY}`,
  );
  type PendingSubjectStatus = "pending" | "in_progress" | "completed";
  const statuses = pendingSubjects.map<PendingSubjectStatus>(() => "pending");
  let cursor = 0;
  let fatalError: unknown = null;
  let quotaError: unknown = null;
  let manifestWriteChain = Promise.resolve();

  const persistManifest = async () => {
    manifest.completedCount =
      skippedExistingCount +
      statuses.filter((status) => status === "completed").length;
    manifest.remainingCount = manifest.totalCount - manifest.completedCount;
    manifest.nextSlug = findNextPendingSlug(pendingSubjects, statuses);
    manifest.updatedAt = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(manifest)) as BulkManifest;
    manifestWriteChain = manifestWriteChain.then(() =>
      writeBulkManifest(outputRoot, snapshot),
    );
    await manifestWriteChain;
  };

  const workerCount = Math.min(DEFAULT_BULK_CONCURRENCY, pendingSubjects.length);

  const runWorker = async () => {
    while (true) {
      if (fatalError || quotaError) {
        return;
      }

      const index = cursor;
      cursor += 1;

      if (index >= pendingSubjects.length) {
        return;
      }

      const subject = pendingSubjects[index];
      const prompt = buildCompressionFriendlyWallpaperPrompt({ subject });
      const filename = buildBulkWallpaperFilename(subject.slug, options.outputFormat);
      const outputPath = resolve(outputRoot, filename);
      statuses[index] = "in_progress";
      await persistManifest();

      try {
        const imageBytes = await generateWallpaperWithRetries({
          apiKey: resolvedApiKey,
          baseUrl: options.baseUrl,
          model: options.model,
          outputCompression: options.outputCompression,
          outputFormat: options.outputFormat,
          outputSize: options.outputSize,
          prompt,
          quality: options.quality,
        });
        await writeFile(outputPath, imageBytes.bytes);
        statuses[index] = "completed";
        manifest.lastCompletedSlug = subject.slug;
        manifest.error = null;
        console.error(
          `Generated ${subject.slug} (${skippedExistingCount + statuses.filter((status) => status === "completed").length}/${manifest.totalCount})`,
        );
        await persistManifest();
      } catch (error) {
        statuses[index] = "pending";
        manifest.error = summarizeBulkError(error);

        if (isQuotaExhaustedError(error)) {
          quotaError ??= error;
          console.error(
            `Quota exhausted while generating ${subject.slug}. Waiting for in-flight requests to settle before pausing.`,
          );
        } else {
          fatalError ??= error;
        }

        await persistManifest();
      }
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker()),
  );

  manifest.nextSlug = findNextPendingSlug(pendingSubjects, statuses);
  manifest.updatedAt = new Date().toISOString();

  if (quotaError) {
    manifest.status = "paused_quota";
    await persistManifest();
    console.error(
      `Paused bulk generation at ${manifest.nextSlug ?? "the end"} after ${manifest.completedCount}/${manifest.totalCount}. Quota exhausted. Rerun the same command to resume.`,
    );
    return manifest;
  }

  if (fatalError) {
    manifest.status = "failed";
    await persistManifest();
    throw fatalError;
  }

  manifest.status = "completed";
  await persistManifest();
  console.error(`Bulk wallpaper generation complete in ${outputRoot}`);
  return manifest;
}

function resolveGeneratorOptions(args: ParsedArgs): GeneratorOptions {
  const apiKey = normalizeOptionalString(process.env.OPENAI_API_KEY);
  const baseUrl =
    normalizeOptionalString(args.baseUrl ?? process.env.OPENAI_BASE_URL) ??
    DEFAULT_BASE_URL;
  const model =
    normalizeOptionalString(args.model ?? process.env.OPENAI_IMAGE_MODEL) ??
    DEFAULT_WALLPAPER_MODEL;
  const outputFormat = parseOutputFormat(
    args.outputFormat ?? process.env.OPENAI_IMAGE_OUTPUT_FORMAT,
  );
  const outputCompression =
    outputFormat === "png"
      ? null
      : parseCompression(
          args.outputCompression ?? process.env.OPENAI_IMAGE_OUTPUT_COMPRESSION,
          DEFAULT_WALLPAPER_OUTPUT_COMPRESSION,
        );
  const outputSize = normalizeSize(
    args.size ?? process.env.OPENAI_IMAGE_SIZE ?? DEFAULT_WALLPAPER_SIZE,
  );

  return {
    apiKey,
    baseUrl,
    dryRun: args.dryRun === "true",
    model,
    outputCompression,
    outputFormat,
    outputSize,
    quality: DEFAULT_WALLPAPER_QUALITY,
  };
}

async function generateWallpaperWithRetries(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputCompression: number | null;
  outputFormat: WallpaperOutputFormat;
  outputSize: string;
  prompt: string;
  quality: WallpaperQuality;
}) {
  let attempt = 0;

  while (true) {
    try {
      return await requestWallpaper(options);
    } catch (error) {
      if (!isRetryableRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw error;
      }

      const delayMs = computeRateLimitDelay(attempt);
      attempt += 1;
      console.error(
        `Rate limited by OpenAI, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES}).`,
      );
      await sleep(delayMs);
    }
  }
}

async function requestWallpaper(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputCompression: number | null;
  outputFormat: WallpaperOutputFormat;
  outputSize: string;
  prompt: string;
  quality: WallpaperQuality;
}) {
  const response = await fetch(
    `${options.baseUrl.replace(/\/+$/u, "")}/images/generations`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        quality: options.quality,
        size: options.outputSize,
        output_format: options.outputFormat,
        ...(options.outputCompression === null
          ? {}
          : { output_compression: options.outputCompression }),
      }),
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    },
  );

  return extractImageResponse(response);
}

async function extractImageResponse(response: Response) {
  const requestId = response.headers.get("x-request-id");

  if (!response.ok) {
    const errorText = await response.text();
    const parsedError = parseOpenAiErrorPayload(errorText);

    throw new OpenAiApiError(
      parsedError?.message ??
        `OpenAI image request failed with ${response.status}: ${errorText.slice(0, 600)}`,
      {
        code: parsedError?.code ?? null,
        requestId,
        status: response.status,
        type: parsedError?.type ?? null,
      },
    );
  }

  const payload = (await response.json()) as OpenAiImageResponse;
  const imageBase64 = payload.data?.[0]?.b64_json;

  if (!imageBase64) {
    throw new OpenAiApiError(
      "OpenAI image response did not contain image data.",
      {
        requestId,
        status: response.status,
      },
    );
  }

  return {
    bytes: Buffer.from(imageBase64, "base64"),
    revisedPrompt: payload.data?.[0]?.revised_prompt ?? null,
  };
}

function parseSubject(args: ParsedArgs): WallpaperSubject {
  const animalInput = normalizeOptionalString(args.animal);
  const adjectiveInput = normalizeOptionalString(args.adjective);

  if (!animalInput && !adjectiveInput) {
    return buildRandomWallpaperSubject();
  }

  const animal = animalInput
    ? parseAnimal(animalInput)
    : pickRandomWord(vmNameAnimals, Math.random);
  const adjective = adjectiveInput
    ? parseAdjective(adjectiveInput)
    : pickRandomWord(vmNameAdjectives, Math.random);
  return buildWallpaperSubjectFromParts(animal, adjective);
}

function parseAnimal(value: string): VmNameAnimal {
  if (!vmNameAnimals.includes(value as VmNameAnimal)) {
    throw new Error(
      `Unsupported animal "${value}". Choose one of: ${vmNameAnimals.join(", ")}`,
    );
  }

  return value as VmNameAnimal;
}

function parseAdjective(value: string): VmNameAdjective {
  if (!vmNameAdjectives.includes(value as VmNameAdjective)) {
    throw new Error(
      `Unsupported adjective "${value}". Choose one of: ${vmNameAdjectives.join(", ")}`,
    );
  }

  return value as VmNameAdjective;
}

function buildSingleOutputFilename(
  slug: string,
  size: string,
  outputFormat: WallpaperOutputFormat,
  variant: number,
): string {
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  return `${slugify(slug)}-${size}-v${variant}.${extension}`;
}

function normalizeSize(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+x\d+$/u.test(trimmed)) {
    throw new Error(`Expected a size like 1536x1024 but received "${value}".`);
  }

  return trimmed;
}

function parseOutputFormat(value: string | undefined): WallpaperOutputFormat {
  const format =
    normalizeOptionalString(value) ?? DEFAULT_WALLPAPER_OUTPUT_FORMAT;

  if (format !== "jpeg" && format !== "png" && format !== "webp") {
    throw new Error('Expected output format "jpeg", "png", or "webp".');
  }

  return format;
}

function parseCompression(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 100) {
    throw new Error(
      `Expected output compression between 0 and 100 but received "${value}".`,
    );
  }

  return parsedValue;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Expected a positive integer but received "${value}".`);
  }

  return parsedValue;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsedArgs: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const withoutPrefix = current.slice(2);
    if (withoutPrefix.length === 0) {
      continue;
    }
    const equalsIndex = withoutPrefix.indexOf("=");
    const normalizedKey = normalizeArgKey(
      equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix,
    );

    if (equalsIndex >= 0) {
      parsedArgs[normalizedKey] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      parsedArgs[normalizedKey] = nextValue;
      index += 1;
      continue;
    }

    parsedArgs[normalizedKey] = "true";
  }

  return parsedArgs;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeArgKey(value: string): keyof ParsedArgs {
  const normalized = value.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );

  return normalized as keyof ParsedArgs;
}

function assertApiKeyPresent(apiKey: string | null, dryRun: boolean) {
  if (!apiKey && !dryRun) {
    throw new Error("OPENAI_API_KEY is required unless --dry-run is set.");
  }
}

async function listExistingFilenames(directory: string): Promise<Set<string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );
}

async function writeSingleManifest(runDirectory: string, manifest: RunManifest) {
  await writeFile(
    resolve(runDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function writeBulkManifest(directory: string, manifest: BulkManifest) {
  await writeFile(
    resolve(directory, BULK_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function parseOpenAiErrorPayload(text: string): {
  code: string | null;
  message: string | null;
  type: string | null;
} | null {
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: string; message?: string; type?: string };
    };
    return {
      code: parsed.error?.code ?? null,
      message: parsed.error?.message ?? null,
      type: parsed.error?.type ?? null,
    };
  } catch {
    return null;
  }
}

function summarizeBulkError(error: unknown): BulkRunErrorSummary {
  if (error instanceof OpenAiApiError) {
    return {
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      status: error.status,
      type: error.type,
    };
  }

  return {
    code: null,
    message: error instanceof Error ? error.message : String(error),
    requestId: null,
    status: null,
    type: null,
  };
}

function findNextPendingSlug(
  subjects: readonly WallpaperSubject[],
  statuses: readonly ("pending" | "in_progress" | "completed")[],
): string | null {
  for (let index = 0; index < subjects.length; index += 1) {
    if (statuses[index] !== "completed") {
      return subjects[index]?.slug ?? null;
    }
  }

  return null;
}

function isQuotaExhaustedError(error: unknown): boolean {
  if (!(error instanceof OpenAiApiError)) {
    return false;
  }

  if (error.status !== 429) {
    return false;
  }

  return (
    error.code === "insufficient_quota" ||
    error.type === "insufficient_quota" ||
    /insufficient quota|exceeded your current quota|billing/i.test(error.message)
  );
}

function isRetryableRateLimitError(error: unknown): boolean {
  if (!(error instanceof OpenAiApiError)) {
    return false;
  }

  return error.status === 429 && !isQuotaExhaustedError(error);
}

function computeRateLimitDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    RATE_LIMIT_MAX_DELAY_MS,
    RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt,
  );
  const jitter = Math.floor(Math.random() * 1_000);
  return exponentialDelay + jitter;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

function isDirectExecution(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) {
    return false;
  }

  return moduleUrl === pathToFileURL(resolve(argv1)).href;
}
