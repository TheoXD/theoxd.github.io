// Builds public/TheoHallenius_CV7.pdf from cv/resume.json. Runs before `astro build`.
// Edit resume.json (and add logos to cv/logos/) to change the CV.
import { readFile, writeFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { renderResume } from "./render.mjs";

const here = new URL(".", import.meta.url);
const OUTPUT = new URL("../public/TheoHallenius_CV7.pdf", here);

const data = JSON.parse(await readFile(new URL("resume.json", here), "utf8"));
const fonts = {
  regular: await readFile(new URL("fonts/Inter-Regular.ttf", here)),
  semibold: await readFile(new URL("fonts/Inter-SemiBold.ttf", here)),
};
// The photo path is a site path like "/profile.jpg", served from public/.
const photo = data.photo ? await readFile(new URL(`../public${data.photo}`, here)) : null;
const logos = {};
const loadLogos = async (entries) => {
  for (const entry of entries || []) {
    if (entry.logo && !logos[entry.logo]) logos[entry.logo] = await readFile(new URL(`logos/${entry.logo}.png`, here));
    await loadLogos(entry.projects);
  }
};
for (const section of data.sections) await loadLogos(section.entries);

const { bytes, fontSize, lineHeight, wrapped, links } = await renderResume({ data, fonts, logos, photo, fontkit });
await writeFile(OUTPUT, bytes);
console.log(`CV: wrote ${OUTPUT.pathname} (${(bytes.length / 1024).toFixed(0)} KB, ${fontSize}pt text, ${lineHeight}x line height, ${links} links)`);
for (const b of wrapped) console.log(`CV: bullet wraps to a second line: "${b}"`);
