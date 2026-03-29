import { slugify } from "./helpers.js";
import {
  buildWallpaperSubjectFromParts,
  type WallpaperOutputFormat,
  type WallpaperSubject,
} from "./wallpaper-prompts.js";
import { vmNameAdjectives, vmNameAnimals } from "./vm-name-words.js";

export function buildAllWallpaperSubjects(): WallpaperSubject[] {
  return vmNameAdjectives.flatMap((adjective) =>
    vmNameAnimals.map((animal) =>
      buildWallpaperSubjectFromParts(animal, adjective),
    ),
  );
}

export function buildBulkWallpaperFilename(
  slug: string,
  outputFormat: WallpaperOutputFormat = "jpeg",
): string {
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  return `${slugify(slug)}.${extension}`;
}

export function collectPendingWallpaperSubjects(
  subjects: readonly WallpaperSubject[],
  existingFilenames: ReadonlySet<string>,
  outputFormat: WallpaperOutputFormat = "jpeg",
): WallpaperSubject[] {
  return subjects.filter(
    (subject) =>
      !existingFilenames.has(
        buildBulkWallpaperFilename(subject.slug, outputFormat),
      ),
  );
}
