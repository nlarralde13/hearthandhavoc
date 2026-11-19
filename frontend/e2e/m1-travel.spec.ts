import { expect, test } from "@playwright/test";

test("player can travel, discover Timberwood, and reload progress", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Choose your beginning" })).toBeVisible();
  await page.getByLabel("Character name").fill("Mara");
  await page.getByRole("button", { name: "Enter the world" }).click();

  await expect(page.getByText("SYSTEM // HOMESTEAD ONLINE · WESTERN ROAD AVAILABLE")).toBeVisible();
  await expect(page.getByTestId("adventure-turn")).toHaveText("0 / 20");
  await page.getByRole("button", { name: "Pause auto-travel" }).click();

  for (let turn = 1; turn <= 6; turn += 1) {
    await page.getByRole("button", { name: "Advance" }).click();
    await expect(page.getByTestId("adventure-turn")).toHaveText(`${turn} / 20`);
  }

  await expect(page.getByText("[Turn 6] Discovered: old_timberwood.")).toBeVisible();
  await page.getByRole("button", { name: "World Map" }).click();
  await expect(page.getByTestId("map-waypoint-6")).toHaveText("Old Timberwood");
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Face the goblin" }).click();
  await expect(page.getByRole("heading", { name: "Goblin in the timber" })).toBeVisible();
  await page.getByRole("button", { name: "Attack" }).click();
  await page.reload();

  await expect(page.getByTestId("adventure-turn")).toHaveText("6 / 20");
  await expect(page.getByRole("heading", { name: "Goblin in the timber" })).toBeVisible();
});
