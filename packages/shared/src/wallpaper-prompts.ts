import {
  buildRandomVmNameParts,
  type VmNameAdjective,
  type VmNameAnimal,
} from "./vm-name-words.js";

export const DEFAULT_WALLPAPER_MODEL = "gpt-image-1.5";
export const DEFAULT_WALLPAPER_SIZE = "1536x1024";
export const DEFAULT_WALLPAPER_OUTPUT_FORMAT = "jpeg";
export const DEFAULT_WALLPAPER_OUTPUT_COMPRESSION = 82;
export const DEFAULT_WALLPAPER_QUALITY = "low" as const;

export type WallpaperQuality = typeof DEFAULT_WALLPAPER_QUALITY;
export type WallpaperOutputFormat = "jpeg" | "png" | "webp";

export interface WallpaperSubject {
  adjective: VmNameAdjective | null;
  animal: VmNameAnimal;
  slug: string;
}

export interface BuildWallpaperPromptOptions {
  subject: WallpaperSubject;
}

export function buildRandomWallpaperSubject(
  random: () => number = Math.random,
): WallpaperSubject {
  const subject = buildRandomVmNameParts(random);

  return {
    adjective: subject.adjective,
    animal: subject.animal,
    slug: subject.slug,
  };
}

export function buildCompressionFriendlyWallpaperPrompt(
  options: BuildWallpaperPromptOptions,
): string {
  const moodLine = options.subject.adjective
    ? `Make the adjective "${options.subject.adjective}" visually unmistakable in the final image through palette, lighting, weather, silhouette, and composition, without rendering any text.`
    : null;
  const adjectiveIdentityLine = options.subject.adjective
    ? `The wallpaper should read clearly as "${options.subject.adjective}-${options.subject.animal}", not just "${options.subject.animal}".`
    : null;

  return [
    "Create a desktop wallpaper for a Linux VM launcher.",
    "Landscape only, 1536x1024 framing.",
    "Match the visual language of Ubuntu 24.04's Monument Valley wallpaper by orbitelambda: abstract low-poly geometry, faceted planes, broad color blocks, and a calm poster-like composition.",
    `Feature a ${options.subject.animal} as the central subject, but render it as a highly abstract shape language integrated into the landscape rather than as a literal animal portrait.`,
    buildAnimalHabitatLine(options.subject.animal),
    moodLine,
    adjectiveIdentityLine,
    "Use the animal's own environment and ecology as the scene basis rather than dropping it into Monument Valley or copying the original wallpaper's landmarks.",
    "Keep the artwork cubist, low-poly, and geometric with broad flat shapes, crisp edges, minimal gradients, and very little fine detail.",
    "Make it compression-friendly: large smooth color regions, limited palette shifts, no film grain, no texture noise, no dithering, and no tiny line work.",
    "The result should feel calm, bold, and desktop-friendly.",
    "No humans, no text, no logo, no watermark, no border, and no photorealism.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildWallpaperSubjectFromParts(
  animal: VmNameAnimal,
  adjective: VmNameAdjective | null = null,
): WallpaperSubject {
  return {
    adjective,
    animal,
    slug: adjective ? `${adjective}-${animal}` : animal,
  };
}

function buildAnimalHabitatLine(animal: VmNameAnimal): string {
  switch (animal) {
    case "axolotl":
      return "Set it in a stylized freshwater canal or lakebed with aquatic plants, dark stones, and still reflective water.";
    case "badger":
      return "Set it in a stylized woodland floor with burrow forms, roots, and low earth mounds.";
    case "bear":
      return "Set it in a stylized alpine forest or tundra edge with rock faces, conifers, and open sky.";
    case "beaver":
      return "Set it in a stylized riverbank with calm water, reeds, dams, and cut-log geometry.";
    case "bison":
      return "Set it in a stylized open prairie with rolling grassland bands and wide weather shapes.";
    case "capybara":
      return "Set it in a stylized riverside wetland with broad water planes, tall grasses, and muddy banks.";
    case "cougar":
      return "Set it in a stylized canyon or mountain scrub habitat with ledges, stone planes, and sparse brush.";
    case "coyote":
      return "Set it in a stylized scrubland or dry grassland with brush, open distance, and dusk shapes.";
    case "crane":
      return "Set it in a stylized wetland with reeds, shallow water reflections, and long horizon lines.";
    case "falcon":
      return "Set it in a stylized cliffside sky with sharp updraft shapes, distant plains, and high ledges.";
    case "ferret":
      return "Set it in a stylized meadow edge with tunnels, grasses, and playful ground contours.";
    case "fox":
      return "Set it in a stylized forest edge with brushy undergrowth, stones, and winding paths.";
    case "gecko":
      return "Set it in a stylized warm rock garden with sunlit stone slabs, sand bands, and hardy plants.";
    case "hedgehog":
      return "Set it in a stylized hedgerow or woodland edge with leaf litter, ferns, and sheltered dusk shapes.";
    case "heron":
      return "Set it in a stylized marsh or lakeshore with reeds, mirror-like water planes, and misty distance.";
    case "hippo":
      return "Set it in a stylized river shallows scene with broad water shapes, mud banks, and reeds.";
    case "jaguar":
      return "Set it in a stylized rainforest with layered leaves, river shadows, and dense canopy planes.";
    case "kingfisher":
      return "Set it in a stylized riverbank with overhanging branches, reeds, and glassy water ribbons.";
    case "koala":
      return "Set it in a stylized eucalyptus grove with pale trunks, soft foliage masses, and quiet sky.";
    case "lemur":
      return "Set it in a stylized tropical forest canopy with branching silhouettes and warm light gaps.";
    case "lynx":
      return "Set it in a stylized snowy forest with fir shapes, rock outcrops, and cold open air.";
    case "manatee":
      return "Set it in a stylized seagrass lagoon with soft underwater light bands and drifting aquatic shapes.";
    case "meerkat":
      return "Set it in a stylized desert scrub or savanna with burrow mounds, warm sand bands, and long lookout lines.";
    case "moose":
      return "Set it in a stylized boreal wetland with reflective water, dark pines, and misty ground.";
    case "otter":
      return "Set it in a stylized river or kelp-coast habitat with flowing water curves, reeds, and smooth stones.";
    case "owl":
      return "Set it in a stylized twilight woodland with tree silhouettes, moonlit negative space, and still air.";
    case "panda":
      return "Set it in a stylized bamboo forest with vertical stalk rhythms, foggy depth, and soft slopes.";
    case "panther":
      return "Set it in a stylized night jungle with dark foliage planes, moonlit openings, and sleek rock forms.";
    case "parrot":
      return "Set it in a stylized tropical canopy with bright leaf masses, fruit forms, and shafts of warm light.";
    case "penguin":
      return "Set it in a stylized polar shoreline with ice planes, dark sea bands, and wind-scoured snow.";
    case "puffin":
      return "Set it in a stylized sea cliff habitat with ocean bands, windswept turf, and steep rock faces.";
    case "rabbit":
      return "Set it in a stylized meadow with grasses, burrow mounds, wildflower patches, and gentle hills.";
    case "raven":
      return "Set it in a stylized cold cliff or northern forest habitat with dark stone planes, snow light, and open sky.";
    case "seal":
      return "Set it in a stylized icy shoreline with rounded surf shapes, slick rocks, and pale sea bands.";
    case "sloth":
      return "Set it in a stylized rainforest canopy with hanging branch forms, leaves, and humid layered air.";
    case "sparrow":
      return "Set it in a stylized hedgerow or garden edge with seed-head shapes, fence rhythms, and open sky.";
    case "stoat":
      return "Set it in a stylized snowfield or meadow edge with tunnels, grasses, and quick directional lines.";
    case "tiger":
      return "Set it in a stylized jungle or tall-grass habitat with striped foliage rhythms and shallow water shapes.";
    case "toucan":
      return "Set it in a stylized rainforest canopy with oversized leaves, fruit clusters, and humid open air.";
    case "turtle":
      return "Set it in a stylized shoreline or pond habitat with smooth stones, water planes, and reeds.";
    case "weasel":
      return "Set it in a stylized field margin with grasses, low brush, and darting ground paths.";
    case "wombat":
      return "Set it in a stylized grassland or eucalyptus woodland with burrow entrances, earth mounds, and low scrub.";
    case "yak":
      return "Set it in a stylized high mountain plateau with wind-shaped grass, broad sky, and distant snow forms.";
  }
}
