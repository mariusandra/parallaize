import type {
  GenerateTemplateScriptsInput,
  GenerateTemplateScriptsResult,
  TemplateEnvVar,
  TemplateScript,
} from "../../../packages/shared/src/types.js";
import type { AppConfig } from "./config.js";
import {
  DEFAULT_TEMPLATE_SCRIPT_NAME,
  normalizeTemplateEnvVars,
  normalizeTemplateScripts,
} from "./template-scripts.js";

const SYSTEM_PROMPT = `You generate safe, idempotent Ubuntu VM boot scripts for Parallaize templates.

Return JSON matching the provided schema. Do not include markdown.

Context:
- Scripts run as root via bash inside a freshly created Ubuntu VM.
- Scripts are copied into /var/lib/parallaize/template-scripts and executed by the Parallaize boot harness.
- Environment variables listed in envVars are exported before scripts run.
- Dependencies are expressed by script id or script name; the server normalizes them to ids.
- runMode "after-previous" means run after all earlier UI-ordered scripts; "parallel" means the script may run as soon as its explicit dependencies are finished.

Requirements:
- Prefer idempotent commands that can be rerun safely.
- Use set -euo pipefail near the top of shell scripts unless the task requires custom error handling.
- Avoid writing secrets into logs, files, shell history, package manager arguments, or process titles.
- If a value should be supplied by the user, add an env var with an empty string value.
- Preserve existing scripts unless the user asks to replace them.
- If targetScriptId is provided, modify that script when appropriate; otherwise add one or more scripts.
- Keep scripts focused and readable. Use apt-get noninteractively when installing packages.
- Extract every required configurable value, API key, token, username, URL, region, or project id into envVars.
- Never invent real secret values. Leave generated env var values empty unless a non-secret default is safe.
- If the prompt is unrelated to VM boot configuration, return the existing scripts/envVars with a brief summary.`;

const SCRIPT_GENERATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "envVars", "scripts"],
  properties: {
    summary: {
      type: "string",
      description: "A concise explanation of the generated or modified scripts.",
    },
    envVars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value"],
        properties: {
          name: {
            type: "string",
            description: "A shell-safe environment variable name.",
          },
          value: {
            type: "string",
            description: "The value to inject. Use an empty string for secrets.",
          },
        },
      },
    },
    scripts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "content", "dependsOn", "runMode"],
        properties: {
          id: {
            type: "string",
            description: "Stable script id using lowercase letters, numbers, dots, underscores, or dashes.",
          },
          name: {
            type: "string",
            description: "Human-readable file name such as user-init.sh.",
          },
          content: {
            type: "string",
            description: "Bash script content.",
          },
          dependsOn: {
            type: "array",
            items: {
              type: "string",
            },
          },
          runMode: {
            type: "string",
            enum: ["after-previous", "parallel"],
          },
        },
      },
    },
  },
} as const;

interface ResponsesApiResult {
  output_parsed?: unknown;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      refusal?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

export async function generateTemplateScriptsWithOpenAI(
  config: Pick<AppConfig, "openaiApiKey" | "openaiModel">,
  input: GenerateTemplateScriptsInput,
): Promise<GenerateTemplateScriptsResult> {
  if (!config.openaiApiKey) {
    throw new Error(
      "OpenAI script generation requires PARALLAIZE_OPENAI_API_KEY or OPENAI_API_KEY.",
    );
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";

  if (!prompt) {
    throw new Error("A script generation prompt is required.");
  }

  const currentEnvVars = normalizeTemplateEnvVars(input.envVars);
  const currentScripts = normalizeTemplateScripts(input.scripts);
  const requestPayload = {
    prompt: prompt.slice(0, 12000),
    targetScriptId: input.targetScriptId ?? null,
    template: {
      name: input.templateName ?? "",
      description: input.templateDescription ?? "",
      launchSource: input.launchSource ?? "",
      resources: input.resources ?? null,
      envVars: currentEnvVars.map(({ name, value }) => ({
        name,
        hasValue: value.length > 0,
      })),
      scripts: currentScripts.map((script) => ({
        id: script.id,
        name: script.name,
        content: script.content,
        dependsOn: script.dependsOn,
        runMode: script.runMode,
      })),
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify(requestPayload),
        },
      ],
      reasoning: {
        effort: "low",
      },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "parallaize_template_script_generation",
          strict: true,
          schema: SCRIPT_GENERATION_SCHEMA,
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as ResponsesApiResult;

  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `OpenAI script generation failed with HTTP ${response.status}.`,
    );
  }

  const parsed = parseOpenAiStructuredOutput(payload);
  const generatedEnvVars = normalizeTemplateEnvVars(parsed.envVars);
  const generatedScripts = normalizeTemplateScripts(parsed.scripts);

  return {
    summary:
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Generated template scripts.",
    envVars: mergeGeneratedEnvVars(currentEnvVars, generatedEnvVars),
    scripts:
      generatedScripts.length > 0
        ? generatedScripts
        : ensureDefaultTemplateScript(currentScripts),
  };
}

function parseOpenAiStructuredOutput(payload: ResponsesApiResult): {
  summary?: unknown;
  envVars?: TemplateEnvVar[];
  scripts?: TemplateScript[];
} {
  if (payload.output_parsed && typeof payload.output_parsed === "object") {
    return payload.output_parsed as {
      summary?: unknown;
      envVars?: TemplateEnvVar[];
      scripts?: TemplateScript[];
    };
  }

  const text = payload.output_text ?? extractResponsesText(payload);

  if (!text) {
    throw new Error("OpenAI did not return generated template scripts.");
  }

  const normalizedText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(normalizedText) as {
    summary?: unknown;
    envVars?: TemplateEnvVar[];
    scripts?: TemplateScript[];
  };
}

function extractResponsesText(payload: ResponsesApiResult): string {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? content.refusal ?? "")
    .filter((entry) => entry.length > 0)
    .join("\n");
}

function mergeGeneratedEnvVars(
  currentEnvVars: TemplateEnvVar[],
  generatedEnvVars: TemplateEnvVar[],
): TemplateEnvVar[] {
  const byName = new Map<string, TemplateEnvVar>();

  for (const envVar of currentEnvVars) {
    byName.set(envVar.name, envVar);
  }

  for (const envVar of generatedEnvVars) {
    const current = byName.get(envVar.name);
    byName.set(envVar.name, {
      name: envVar.name,
      value: current?.value ?? envVar.value,
    });
  }

  return [...byName.values()];
}

function ensureDefaultTemplateScript(scripts: TemplateScript[]): TemplateScript[] {
  if (scripts.length > 0) {
    return scripts;
  }

  return [
    {
      id: "user-init",
      name: DEFAULT_TEMPLATE_SCRIPT_NAME,
      content: "#!/usr/bin/env bash\nset -euo pipefail\n",
      dependsOn: [],
      runMode: "after-previous",
    },
  ];
}
