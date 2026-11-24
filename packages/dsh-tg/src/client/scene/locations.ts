// The four groups of the scene art line up with the game's four regions.
export const sceneByLocation: Record<string, string> = {
  "Bedroom/bedroom_main": "bedroom",
  "Street/street_main": "street",
  "Street/food_stall": "breakfast",
  "Street/convenience_store_entrance": "convenience",
  "Street/bus_stop": "bus",
  "Park/park_entrance": "park",
  "Park/park_path": "path",
  "Park/fountain": "fountain",
  "Park/benches": "benches",
  "Shop/shop_entrance": "shop",
  "Shop/shop_aisles": "aisle",
  "Shop/shop_counter": "checkout",
};

const sceneByRegion: Record<string, string> = {
  Bedroom: "bedroom",
  Street: "street",
  Park: "park",
  Shop: "shop",
};

export function sceneFor(locationId: string): string {
  return (
    sceneByLocation[locationId] ??
    sceneByRegion[locationId.split("/")[0]] ??
    "street"
  );
}