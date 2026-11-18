// Pins down how a part's colour / size picks become a part number
// (src/lib/part-variants.ts). Run with:
//
//     node scripts/checks/part-variants.check.mjs
//
// Every part here is made up.

import { register } from "node:module";
process.removeAllListeners("warning");
register("./ts-resolver.mjs", import.meta.url);

const { settleVariant, variantColors, variantSizes, needsPick, optionCount, partDescription, partDetailLines, partLabel, choiceHint, splitSavedPartName, pickLinkedPart, withSavedLine } =
  await import("../../src/lib/part-variants.ts");

let fails = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log("  ok  " + name);
  else {
    fails++;
    console.log("FAIL  " + name + (extra ? "  " + JSON.stringify(extra) : ""));
  }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// White comes in 24 and 30, Sandtone in 30 only, Bronze has no size.
const grid = {
  colors: ["White", "Sandtone", "Bronze"],
  sizes: ["24", "30"],
  variants: [
    { color: "White", size: "24", partNumber: "W-24" },
    { color: "White", size: "30", partNumber: "W-30" },
    { color: "Sandtone", size: "30", partNumber: "S-30" },
  ],
  details: { descriptions: { "W-24": "White sash lock, 24 in", "W30": "loose key", "S-30": "Sandtone 30" } },
};

console.log("settleVariant");
ok("colour alone with two sizes open is no part number", eq(settleVariant(grid, "White", ""), { color: "White", size: "", partNumber: "" }));
ok("colour with one size fills the size and number", eq(settleVariant(grid, "Sandtone", ""), { color: "Sandtone", size: "30", partNumber: "S-30" }));
ok("size 24 fills White (only colour in 24)", eq(settleVariant(grid, "", "24"), { color: "White", size: "24", partNumber: "W-24" }));
ok("size 30 alone stays open", eq(settleVariant(grid, "", "30"), { color: "", size: "30", partNumber: "" }));
ok("both picked", settleVariant(grid, "White", "30").partNumber === "W-30");
ok("bad combo, colour just changed: size dropped, then filled", eq(settleVariant(grid, "Sandtone", "24", "color"), { color: "Sandtone", size: "30", partNumber: "S-30" }));
ok("bad combo, size just changed: colour dropped, then filled", eq(settleVariant(grid, "Sandtone", "24", "size"), { color: "White", size: "24", partNumber: "W-24" }));
ok("unknown colour dropped", settleVariant(grid, "Purple", "").color === "");
ok("nothing picked", eq(settleVariant(grid, "", ""), { color: "", size: "", partNumber: "" }));

const one = { colors: ["Black"], sizes: [], variants: [{ color: "Black", size: "", partNumber: "B-1" }], details: {} };
ok("single variant settles with no picks", eq(settleVariant(one, "", ""), { color: "Black", size: "", partNumber: "B-1" }));
const none = { colors: ["A", "B"], sizes: [], variants: [], details: {} };
ok("no variants: picks kept, no number", eq(settleVariant(none, "A", ""), { color: "A", size: "", partNumber: "" }));
const shared = {
  colors: ["White", "Tan"],
  sizes: [],
  variants: [
    { color: "White", size: "", partNumber: "SAME" },
    { color: "Tan", size: "", partNumber: "SAME" },
  ],
  details: {},
};
ok("every variant one number: number set, colour open", eq(settleVariant(shared, "", ""), { color: "", size: "", partNumber: "SAME" }));
const blank = { colors: ["A"], sizes: ["1", "2"], variants: [{ color: "A", size: "1", partNumber: "" }, { color: "A", size: "2", partNumber: "A-2" }], details: {} };
ok("a variant with no number never resolves to the other", settleVariant(blank, "A", "").partNumber === "");

console.log("options");
ok("colours for size 24", eq(variantColors(grid, "24"), ["White"]));
ok("colours with no size: only ones a variant has", eq(variantColors(grid), ["White", "Sandtone"]));
ok("sizes for Sandtone", eq(variantSizes(grid, "Sandtone"), ["30"]));
ok("sizes for nothing", eq(variantSizes(grid, ""), ["24", "30"]));
ok("no-variant part offers its lists", eq(variantColors(none), ["A", "B"]));
ok("grid needs a pick", needsPick(grid) && !needsPick(one));
ok("option count", optionCount(grid) === 3 && optionCount(shared) === 1);

console.log("descriptions");
ok("direct", partDescription(grid, "W-24") === "White sash lock, 24 in");
ok("loose key", partDescription(grid, "W-30") === "loose key");
ok("missing", partDescription(grid, "X-1") === undefined && partDescription(grid, "") === undefined);
ok("no details", partDescription({ details: {} }, "W-24") === undefined);
ok("bad details", partDescription({ details: { descriptions: ["x"] } }, "0") === undefined);
ok("detail lines string", eq(partDetailLines({ details: { notes: " Fits 1990+ " } }, "notes"), ["Fits 1990+"]));
ok("detail lines list", eq(partDetailLines({ details: { fits: ["A", "", "B"] } }, "fits"), ["A", "B"]));
ok("detail lines other", eq(partDetailLines({ details: { notes: { a: 1 } } }, "notes"), []));
ok("chip hint when one number", choiceHint(grid, "Sandtone", "") === "Sandtone 30");
ok("no chip hint when several", choiceHint(grid, "White", "") === undefined);
ok("label", partLabel({ category: "Locks", partName: "Sash lock", position: "Top" }) === "Locks — Sash lock · Top");

console.log("saved part lines");
const types = ["Double Hung", "Casement"];
ok("known model splits", eq(splitSavedPartName("Locks — Sash lock (Double Hung)", types), { name: "Locks — Sash lock", productType: "Double Hung" }));
ok("model match ignores case", splitSavedPartName("Hinge (casement)", types).productType === "casement");
ok("custom bracket stays in the name", eq(splitSavedPartName("Screen clip (white)", types), { name: "Screen clip (white)" }));
ok("no bracket", eq(splitSavedPartName("Caulk", types), { name: "Caulk" }));
ok("no known types: whole name", eq(splitSavedPartName("Lock (Double Hung)", []), { name: "Lock (Double Hung)" }));

const loc = { id: "loc", variants: [{ color: "", size: "", partNumber: "L-1" }] };
const ren = { id: "ren", variants: [{ color: "White", size: "", partNumber: "R-1" }, { color: "Tan", size: "", partNumber: "R-2" }] };
const ren2 = { id: "ren2", variants: [{ color: "", size: "", partNumber: "R-1" }] };
ok("one match links", pickLinkedPart([ren], undefined)?.id === "ren");
ok("no match", pickLinkedPart([], "R-1") === undefined);
ok("two matches, no number: unlinked", pickLinkedPart([loc, ren], undefined) === undefined);
ok("two matches, number settles it", pickLinkedPart([loc, ren], "R-2")?.id === "ren");
ok("two matches, number loosely", pickLinkedPart([loc, ren], "r2")?.id === "ren");
ok("two matches, number in neither: unlinked", pickLinkedPart([loc, ren], "X-9") === undefined);
ok("two matches, number in both: unlinked", pickLinkedPart([ren, ren2], "R-1") === undefined);

const saved = {
  item: "Locks — Sash lock (Double Hung)", color: "White", species: "Oak", qty: 2, unit: "PCS", lengths: "2/8", vendor: "Shop",
  custom: false, kind: "part", partNumber: "R-1", size: "", description: "old", workSeq: 4, category: "Keep me", extraField: "kept",
};
const fresh = {
  item: "Locks — Sash lock (Double Hung)", color: "Tan", species: "", qty: 3, unit: "EA", lengths: "", vendor: "",
  custom: false, kind: "part", partNumber: "R-2", size: undefined, description: undefined, workSeq: 1,
};
const merged = withSavedLine(saved, fresh);
ok("saved unit / vendor / species / lengths kept", merged.unit === "PCS" && merged.vendor === "Shop" && merged.species === "Oak" && merged.lengths === "2/8");
ok("unknown fields kept", merged.category === "Keep me" && merged.extraField === "kept");
ok("edited fields from the list", merged.color === "Tan" && merged.qty === 3 && merged.partNumber === "R-2" && merged.workSeq === 1);
ok("cleared description stays cleared", JSON.parse(JSON.stringify(merged)).description === undefined);
ok("a new line is as built", withSavedLine(undefined, fresh) === fresh);

console.log(fails ? `\n${fails} FAILED` : "\nall ok");
process.exit(fails ? 1 : 0);
