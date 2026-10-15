import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";

/** Tiny valid 64x64 PNG generated in memory (no fixture files needed). */
function png(): Buffer {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 4 + 1) + 1 + x * 4;
      raw[i] = x * 4;
      raw[i + 1] = y * 4;
      raw[i + 2] = 200;
      raw[i + 3] = 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("launch → new comp → import image → keyframes → render queue", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  // start screen → new project from a preset
  await page.getByRole("button", { name: /HD 1080p/ }).click();
  await expect(page.getByRole("application", { name: "Composition viewer" })).toBeVisible();

  // import an image through File › Import (browser file chooser)
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Import File/ }).click();
  await (await chooser).setFiles({ name: "logo.png", mimeType: "image/png", buffer: png() });
  await expect(page.getByRole("listitem").filter({ hasText: "logo.png" })).toBeVisible();

  // add it to the comp
  await page.getByRole("listitem").filter({ hasText: "logo.png" }).dblclick();
  await expect(page.getByRole("button", { name: "logo.png" }).first()).toBeVisible();

  // reveal Position (P), enable keyframes, change value at a later time
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Keyframes for Position" }).first().click();
  await page.keyboard.press("Shift+PageDown");
  await page.keyboard.press("Shift+PageDown");
  await page.getByRole("button", { name: /^transform\.position x/ }).first().click();
  const field = page.getByRole("textbox", { name: "transform.position x" });
  await field.fill("300");
  await field.press("Enter");
  await expect(page.getByRole("button", { name: /^Keyframe at/ })).toHaveCount(2);

  // undo/redo
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Keyframe at/ })).toHaveCount(1);
  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByRole("button", { name: /^Keyframe at/ })).toHaveCount(2);

  // add a text layer and an effect
  await page.getByRole("button", { name: "Layer", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Text" }).click();
  await expect(page.getByRole("button", { name: "Your Text" }).first()).toBeVisible();

  // queue the comp for render (encoding itself runs in the desktop app)
  await page.keyboard.press("Control+m");
  await expect(page.getByText(/Add Active Comp/)).toBeVisible();

  expect(errors).toEqual([]);
});
