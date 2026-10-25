// Free & low-cost Atlanta ideas for the Saturday card.
// Checked October 2026. Hours and prices change, so each idea stays general.
// Sources: atlantacontemporary.org, nps.gov (CHAT, KEMO fees), oaklandcemetery.com,
// midtownatl.com (Green Market), stonemountainpark.com, gastateparks.org (ParkPass),
// arabiaalliance.org, freshharvest.com (market list).

export type Cost = "Free" | "$" | "$$";

export interface Idea {
  id: string;
  name: string;
  blurb: string;
  cost: Cost;
  indoor: boolean;
  months?: number[];   // 1–12; omitted = year-round
}

export const IDEAS: Idea[] = [
  {
    id: "beltline-east",
    name: "BeltLine Eastside Trail",
    blurb: "Walk or bike past murals from Ponce City Market down to Krog Street.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "beltline-west",
    name: "BeltLine Westside Trail",
    blurb: "Quieter paved stretch through the West End neighborhoods.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "piedmont",
    name: "Piedmont Park",
    blurb: "Lake loop, skyline views, and plenty of room to sit in the sun.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "green-market",
    name: "Piedmont Park Green Market",
    blurb: "Saturday farmers market, 9 AM to 1 PM. Free to wander, bring cash for snacks.",
    cost: "$",
    indoor: false,
    months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  {
    id: "freedom-market",
    name: "Freedom Farmers Market",
    blurb: "Saturday morning market at the Carter Center, open year-round.",
    cost: "$",
    indoor: false,
  },
  {
    id: "peachtree-market",
    name: "Peachtree Road Farmers Market",
    blurb: "Big Saturday morning market in Buckhead, spring through December.",
    cost: "$",
    indoor: false,
    months: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  {
    id: "contemporary",
    name: "Atlanta Contemporary",
    blurb: "Contemporary art center that's always free. Saturdays 11 AM to 6 PM.",
    cost: "Free",
    indoor: true,
  },
  {
    id: "mlk",
    name: "MLK Jr. National Historical Park",
    blurb: "Visitor center, Ebenezer Baptist Church, and the King birth home block.",
    cost: "Free",
    indoor: true,
  },
  {
    id: "oakland",
    name: "Historic Oakland Cemetery",
    blurb: "Free to stroll dawn to dusk. Gardens, skyline views, and Atlanta history.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "arabia",
    name: "Arabia Mountain",
    blurb: "Moon-like granite trails in Lithonia. No parking or trail fees.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "kennesaw",
    name: "Kennesaw Mountain",
    blurb: "Hike to the summit for a big view of the city. $5 parking.",
    cost: "$",
    indoor: false,
  },
  {
    id: "chattahoochee",
    name: "Chattahoochee River trails",
    blurb: "Flat river trails at Cochran Shoals and other units. $5 per car.",
    cost: "$",
    indoor: false,
  },
  {
    id: "stone-mountain",
    name: "Stone Mountain walk-up trail",
    blurb: "Climb the mountain on foot. Parking is the main cost (about $25).",
    cost: "$$",
    indoor: false,
  },
  {
    id: "sweetwater",
    name: "Sweetwater Creek State Park",
    blurb: "Creekside trail to old mill ruins. $10 state park parking.",
    cost: "$",
    indoor: false,
  },
  {
    id: "krog",
    name: "Krog Street Tunnel & Market",
    blurb: "Graffiti tunnel, then browse the food hall. Only pay if you eat.",
    cost: "Free",
    indoor: true,
  },
  {
    id: "ponce",
    name: "Ponce City Market",
    blurb: "Browse shops and the food hall in the old Sears building.",
    cost: "Free",
    indoor: true,
  },
  {
    id: "fourth-ward",
    name: "Historic Fourth Ward Park",
    blurb: "Pond, splash pad, and skatepark right off the BeltLine.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "westside-park",
    name: "Westside Park",
    blurb: "Atlanta's biggest park, with trails above the old Bellwood Quarry.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "cascade",
    name: "Cascade Springs Nature Preserve",
    blurb: "Short wooded trail to a waterfall in southwest Atlanta.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "chastain",
    name: "Chastain Park trail",
    blurb: "Easy loop trail around the park in Buckhead.",
    cost: "Free",
    indoor: false,
  },
  {
    id: "curb-market",
    name: "Sweet Auburn Curb Market",
    blurb: "Historic market hall downtown with cheap, good lunch counters.",
    cost: "$",
    indoor: true,
  },
  {
    id: "buford-hwy",
    name: "Buford Highway food crawl",
    blurb: "Pick two or three spots and share small plates. Easy on the wallet.",
    cost: "$",
    indoor: true,
  },
  {
    id: "decatur",
    name: "Decatur Square",
    blurb: "Stroll the square, browse the bookstore, grab a coffee.",
    cost: "Free",
    indoor: false,
  },
];

// Small seeded shuffle so each Saturday gets a different, stable set.
function seededShuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed >>> 0;
  // mulberry32: nearby seeds (consecutive weeks) still give very different orders
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Three picks for a given Saturday (yyyy-mm-dd). Rainy days lean indoor. */
export function pickIdeas(date: string, rainChance: number, count = 3): Idea[] {
  const month = Number(date.slice(5, 7));
  const [y, m, d] = date.split("-").map(Number);
  const weekNumber = Math.floor(Date.UTC(y, m - 1, d) / (7 * 86400000));

  const inSeason = IDEAS.filter((i) => !i.months || i.months.includes(month));
  const shuffled = seededShuffle(inSeason, weekNumber * 2654435761);

  if (rainChance >= 50) {
    const indoor = shuffled.filter((i) => i.indoor);
    return [...indoor, ...shuffled.filter((i) => !i.indoor)].slice(0, count);
  }

  // Dry day: make sure at least one outdoor pick is in the mix.
  const picks = shuffled.slice(0, count);
  if (!picks.some((i) => !i.indoor)) {
    const outdoor = shuffled.find((i) => !i.indoor);
    if (outdoor) picks[count - 1] = outdoor;
  }
  return picks;
}
