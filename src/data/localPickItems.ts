/**
 * Viator products the owner has vouched for by hand.
 *
 * "Local pick" used to mean exactly one thing — an entry in `ACTIVITIES`, the
 * hand-written curated set — and `provenancePass` could answer it by asking
 * which KIND of tile it was looking at. That is no longer the whole truth: a
 * bookable Viator product can be a local's recommendation too, and saying so
 * required somewhere for the vouch to live.
 *
 * Why this could not be done by adding rows to `ACTIVITIES` instead: a curated
 * pick whose `viator_item_url` resolves to a product already in the catalog
 * LOSES its tile to that product (`keepsOwnTile` in exploreItems.ts — the
 * product is the canonical listing, and one tile is the point). Both existing
 * curated catamarans are in exactly that position and never render. So marking
 * a product from the outside is the only way the mark survives to the page.
 *
 * Ids are Viator product codes, the same ones `ViatorItem.id` carries. A code
 * that leaves the catalog simply stops matching — nothing here can break a
 * render, and nothing here needs cleaning up on a schedule.
 */
export const LOCAL_PICK_ITEM_IDS = new Set<string>([
  // Jolly Pirates — the same operator's two sails, added 2026-08-20.
  '37387P3', // Aruba Jolly Pirate Afternoon Sail with Snorkeling  ($89, 4.6★/531)
  '37387P2', // Aruba Sunset Jolly Pirate Sail with Open Bar       ($70, 4.6★/465)
  // Palm Pleasure — the catalog carries one Palm Pleasure listing and it is an
  // AFTERNOON sail, not a sunset one, which is worth knowing if this was meant
  // to be a sunset boat.
  '2455HAPPY', // Aruba Afternoon Snorkel Sail aboard Palm Pleasure Catamaran ($85, 4.6★/324)
  // Two jeep safaris to the Natural Pool, added 2026-08-20. Both are the same
  // operator (6841*) and between them carry 19,355 reviews at 5.0.
  '6841ISLAND', // Island Jeep Safari with Natural Pool Baby Beach and Lunch    ($139, 5.0★/10003)
  '6841POOL',   // Aruba Natural Pool and Indian Cave Rugged Jeep Safari        ($99,  5.0★/9352)
]);

export function isLocalPickItem(id: string): boolean {
  return LOCAL_PICK_ITEM_IDS.has(id);
}
