export const vmNameAdjectives = [
  "angry",
  "brisk",
  "calm",
  "clever",
  "cosmic",
  "daring",
  "eager",
  "ember",
  "fancy",
  "frozen",
  "gentle",
  "golden",
  "happy",
  "icy",
  "jolly",
  "keen",
  "lively",
  "lucky",
  "mellow",
  "mighty",
  "nimble",
  "proud",
  "quick",
  "quiet",
  "rapid",
  "rusty",
  "sharp",
  "silver",
  "steady",
  "sunny",
  "swift",
  "tidy",
  "vivid",
  "wild",
] as const;

export const vmNameAnimals = [
  "badger",
  "bear",
  "beaver",
  "bison",
  "cougar",
  "coyote",
  "crane",
  "falcon",
  "ferret",
  "fox",
  "gecko",
  "heron",
  "hippo",
  "jaguar",
  "koala",
  "lemur",
  "lynx",
  "manatee",
  "moose",
  "otter",
  "owl",
  "panda",
  "panther",
  "puffin",
  "rabbit",
  "raven",
  "seal",
  "sloth",
  "sparrow",
  "stoat",
  "tiger",
  "turtle",
  "weasel",
  "yak",
] as const;

export type VmNameAdjective = (typeof vmNameAdjectives)[number];
export type VmNameAnimal = (typeof vmNameAnimals)[number];

export interface VmNameParts {
  adjective: VmNameAdjective;
  animal: VmNameAnimal;
  slug: string;
}

export function buildRandomVmNameParts(
  random: () => number = Math.random,
): VmNameParts {
  const adjective = pickRandomWord(vmNameAdjectives, random);
  const animal = pickRandomWord(vmNameAnimals, random);

  return {
    adjective,
    animal,
    slug: `${adjective}-${animal}`,
  };
}

export function pickRandomWord<T extends readonly string[]>(
  words: T,
  random: () => number,
): T[number] {
  const index = Math.min(
    words.length - 1,
    Math.max(0, Math.floor(random() * words.length)),
  );

  return (words[index] ?? words[0] ?? "workspace") as T[number];
}
