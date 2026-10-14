# Rules of this remake

The rules follow the 1983 original as closely as is known, with numbers kept in
`src/core/constants.ts`. Where the original's exact formula isn't documented
(store pricing, some event amounts) the remake uses a simple model with the
same feel. Everything here is enforced by the core and covered by
`tests/core.test.ts`.

## Setup

- Four colonists (1 human + 3 computer in v1). Species only changes starting
  money: Flapper $1600 (easy), Humanoid $600 (hard), everyone else $1000.
- Everyone starts with 4 food and 2 energy.
- Map: 9 × 5 plots. The river runs down the middle column, the town sits in
  its centre, 8–11 mountains (1–3 peaks) are scattered off the river. Crystite
  is hidden in 3–4 deposits (level 4 at the centre, falling off around it).
- Store: 8 food, 8 energy, 8 smithore, 14 MULEs at $100 (beginner: 16/16/0, 25).
- Game length: Beginner 6 rounds (no crystite, no land auctions),
  Standard and Tournament 12 rounds (Tournament's wampus is quicker).

## A round

1. **Status**: standings, food needed, MULE price.
2. **Land grant**: a cursor visits each free plot in reading order (0.7 s
   each). Each colonist may claim one plot.
3. **Land auctions**: plots put up at the land office the previous round, plus
   (35% of rounds 2–11) one colony plot. Bidding starts at $160 and goes up in
   $4 steps while a bidder holds the button; a new high bid keeps the auction
   open at least 2.5 s. The seller (if a colonist) receives the price.
4. **Development**: colonists take turns, last place first.
   - At the start of a turn the colonist eats food: 3 per round in rounds 1–4,
     4 in 5–8, 5 in 9–12. A full meal gives 47.5 s; with less the turn shrinks
     linearly to 5 s for no food.
   - 27.5% chance of a personal event (good luck never goes to the leader,
     bad luck never to the last-place colonist). Amounts scale with the round:
     $25 (rounds 1–3), $50 (4–7), $75 (8–11), $100 (12) per unit.
   - Town: corral (buy a MULE at the current price, or return one for a
     refund), outfitters (food $25, energy $50, smithore $75, crystite $100),
     pub (wins round bonus $50/$100/$150/$200 plus up to $4 per second left,
     max $250, and ends the turn; no MULEs inside), assay office (reveals the
     crystite level of a sampled plot), land office (put a plot up for auction).
   - Map: on your own plot, the action button installs the outfitted MULE
     (swapping out any MULE already there, which then follows you). Releasing
     a MULE on someone else's land, or an un-outfitted one, loses it. Without a
     MULE the action button takes a soil sample. A MULE still in tow when time
     runs out is lost.
   - The mountain wampus blinks into view on a random mountain now and then;
     touching it pays $100/$200/$300/$400 by round group, once per turn.
5. **Production**:
   - Every non-energy MULE needs 1 energy; without it, it produces nothing.
   - Spoilage of what was carried over: half the food, a quarter of the
     energy, smithore and crystite above 50.
   - Output per MULE: base by terrain (food: river 4, plain 2, mountain 1;
     energy: river 2, plain 3, mountain 1; smithore: river 0, plain 1,
     mountains 2/3/4 by peaks; crystite = deposit level 0–4), +1 if an adjacent
     plot of the same owner makes the same thing, +1 per three plots the owner
     has on that resource, then −1/0/+1 luck (weighted 1:3:1), capped at 8.
   - Colony events (55% of rounds): pests (one farm's crop lost), acid rain
     (one row: food +4, energy −2), sunspots (energy +3), planetquake (mining
     halved), meteorite (new level-4 crystite deposit, destroys a MULE there),
     radiation (one MULE lost), store fire (store stock lost), pirates (all
     crystite stolen).
6. **Auctions**: smithore, crystite, food, energy.
   - Status board, then each colonist declares buyer or seller (default:
     seller if above the critical level, i.e. what they need next round).
   - Trading: buyers start at the store's buy price and raise; sellers start at
     the top and lower. When a bid meets an ask, one unit changes hands every
     0.25 s at that price and the 14 s clock pauses. The store always buys at
     its floor price and sells at floor + $35 while it has stock; when it is
     sold out the ceiling rises. A seller stops automatically at the critical
     level and must press down again to sell below it.
7. **End of round**: store re-prices. Food and energy follow colony supply vs.
   next round's demand, smithore follows the store's stock, crystite is set by
   off-world demand ($50–$150). At the next round start the store turns smithore
   into MULEs (2 each, up to 25); the MULE price is twice the smithore price
   (min $100), +25% when fewer than 4 are left.

## Scoring

Money + land ($500 per plot + the MULE price for each installed MULE) + goods
at the store's buy price. The richest colonist is the First Founder. The
colony total is rated from Failure (< $40,000) to Superior (≥ $120,000).
