// THROWAWAY: compare the two permissive OOV fallbacks on words missing from the Misaki lexicons.
import { createRequire } from "node:module";
import { createG2P } from "./g2p.mjs";
const { toIPA } = createRequire(import.meta.url)("phonemize"); // ESM build is broken under Node (json import attribute)
const g = await createG2P();
for (const w of ["Siobhan", "Nguyen", "Elena", "Kavanagh", "Marcus", "Aoife", "Dmitri", "Priya", "Xiomara", "Beauchamp", "Zorblax", "Thackeray", "Ottoline", "Grzegorz", "Imogen"])
  console.log(w.padEnd(11), (await g(w)).padEnd(14), toIPA(w, { affricates: "ligature" }));
