import { randomInt } from "node:crypto";

// Memorable agent names like CopperGrove or NavyRaven: a colour or material plus a place or creature.
const first = [
  "Amber",
  "Arctic",
  "Azure",
  "Birch",
  "Bronze",
  "Cedar",
  "Cobalt",
  "Copper",
  "Coral",
  "Crimson",
  "Dawn",
  "Ember",
  "Frost",
  "Garnet",
  "Golden",
  "Granite",
  "Hazel",
  "Icy",
  "Indigo",
  "Ivory",
  "Jade",
  "Juniper",
  "Lunar",
  "Maple",
  "Misty",
  "Navy",
  "Olive",
  "Onyx",
  "Opal",
  "Pearl",
  "Plum",
  "Quartz",
  "Ruby",
  "Russet",
  "Sable",
  "Saffron",
  "Scarlet",
  "Silver",
  "Slate",
  "Solar",
  "Teal",
  "Topaz",
  "Velvet",
  "Violet",
  "Willow",
  "Winter",
];
const second = [
  "Badger",
  "Basin",
  "Beacon",
  "Canyon",
  "Comet",
  "Cove",
  "Crane",
  "Delta",
  "Falcon",
  "Fern",
  "Fox",
  "Glacier",
  "Grove",
  "Harbor",
  "Heron",
  "Horizon",
  "Island",
  "Lagoon",
  "Lark",
  "Lynx",
  "Meadow",
  "Mesa",
  "Orchid",
  "Otter",
  "Owl",
  "Peak",
  "Pine",
  "Quill",
  "Raven",
  "Reef",
  "Ridge",
  "River",
  "Sparrow",
  "Spruce",
  "Summit",
  "Swift",
  "Tide",
  "Tiger",
  "Valley",
  "Willow",
  "Wolf",
  "Wren",
];

// A name that no other agent in the project has. Falls back to a numeric suffix if the pool runs dry.
export function agentName(taken = new Set()) {
  for (let i = 0; i < 80; i++) {
    const name =
      first[randomInt(first.length)] + second[randomInt(second.length)];
    if (!taken.has(name)) return name;
  }
  for (;;) {
    const name =
      first[randomInt(first.length)] +
      second[randomInt(second.length)] +
      randomInt(10, 100);
    if (!taken.has(name)) return name;
  }
}
