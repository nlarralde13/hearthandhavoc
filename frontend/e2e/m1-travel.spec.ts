import { expect, test } from "@playwright/test";

test("player can travel, discover Timberwood, and reload progress", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "The road west waits." })).toBeVisible();
  await expect(page.getByTestId("adventure-turn")).toHaveText("0 / 20");
  await expect(page.getByTestId("route-waypoint-6")).toHaveText("Unexplored waypoint");
  await expect(page.getByTestId("route-waypoint-20")).toHaveText("Unexplored waypoint");
  await page.getByRole("button", { name: "Pause auto-travel" }).click();

  for (let turn = 1; turn <= 6; turn += 1) {
    await page.getByRole("button", { name: "Advance one turn" }).click();
    await expect(page.getByTestId("adventure-turn")).toHaveText(`${turn} / 20`);
  }

  await expect(page.getByTestId("route-waypoint-6")).toHaveText("Old Timberwood");
  await expect(page.getByTestId("route-waypoint-20")).toHaveText("Unexplored waypoint");
  await page.getByRole("button", { name: "Face the goblin" }).click();
  await expect(page.getByRole("heading", { name: "Goblin in the timber" })).toBeVisible();
  await page.getByRole("button", { name: "Attack" }).click();
  await page.reload();

  await expect(page.getByTestId("adventure-turn")).toHaveText("6 / 20");
  await expect(page.getByTestId("route-waypoint-6")).toHaveText("Old Timberwood");
  await expect(page.getByRole("heading", { name: "Goblin in the timber" })).toBeVisible();
});
