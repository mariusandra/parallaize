const vmNameAdjectives = [
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
];

const vmNameAnimals = [
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
];

export function buildRandomVmName(
  random: () => number = Math.random,
): string {
  return `${pickRandomWord(vmNameAdjectives, random)}-${pickRandomWord(vmNameAnimals, random)}`;
}

function pickRandomWord(
  words: readonly string[],
  random: () => number,
): string {
  const index = Math.min(
    words.length - 1,
    Math.max(0, Math.floor(random() * words.length)),
  );

  return words[index] ?? words[0] ?? "workspace";
}
