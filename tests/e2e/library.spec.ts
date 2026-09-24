import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { command } from "../../lib/command.ts";
test.beforeEach(async ({ request, context }) => {
  const r = await request.post("/api/session", {
    data: { password: process.env.APP_PASSWORD },
  });
  expect(r.status()).toBe(200);
  await context.addCookies((await request.storageState()).cookies);
});
test("private APIs, files and mutations reject unauthenticated and cross-origin access", async ({
  request,
  playwright,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  for (const url of [
    "/api/hymns",
    "/api/library",
    "/api/scores/67/f/d9901de0e9ae2fab/score.pdf",
  ]) {
    expect((await anonymous.get(url)).status()).toBe(401);
  }
  expect((await anonymous.post("/api/upload")).status()).toBe(401);
  expect(
    (
      await request.post("/api/render", {
        headers: { Origin: "https://other.example" },
        data: { hymnId: "67", key: "f" },
      })
    ).status(),
  ).toBe(403);
  const pdf = await request.get("/api/scores/67/f/d9901de0e9ae2fab/score.pdf");
  expect(pdf.headers()["cache-control"]).toBe("private, no-store");
  await anonymous.dispose();
});
test("upload validation rejects a disguised non-image", async ({ request }) => {
  const r = await request.post("/api/upload", {
    multipart: {
      title: "검증용",
      keys: '["f"]',
      file: {
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      },
    },
  });
  expect(r.status()).toBe(400);
});
test("upload, recognize, review, generate two keys, search duplicates and reload", async ({
  page,
  request,
}, info) => {
  test.setTimeout(300_000);
  const name = `시험 악보 ${randomUUID().slice(0, 8)}`;
  let input = process.env.OMR_TEST_IMAGE;
  if (!input) {
    const response = await request.post("/api/render", {
      data: { hymnId: "67", key: "f" },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    const pdf = info.outputPath("omr-source.pdf");
    const prefix = info.outputPath("omr-source");
    await writeFile(pdf, await (await request.get(result.pdfUrl)).body());
    await command(
      "pdftoppm",
      ["-r", "300", "-f", "1", "-singlefile", "-png", pdf, prefix],
      { timeout: 60_000 },
    );
    input = prefix + ".png";
  }
  await page.goto("/upload");
  await page.getByLabel("악보 사진", { exact: true }).setInputFiles(input);
  await page.getByLabel("악보 제목", { exact: true }).fill(name);
  await page.getByLabel("찬송가 번호").fill("67");
  await page
    .locator(".key-picker label")
    .filter({ hasText: /^A$/ })
    .getByRole("checkbox")
    .uncheck();
  await page.getByRole("button", { name: "사진 분석 시작" }).click();
  await expect(page).toHaveURL(/\/hymns\/u-/);
  const id = page.url().split("/hymns/")[1];
  await expect(
    page.getByRole("button", { name: "분석 결과 확인 · 선택한 조 생성" }),
  ).toBeVisible({ timeout: 210_000 });
  await expect(page.getByAltText("올린 원본 악보")).toBeVisible();
  if (!process.env.OMR_TEST_IMAGE) {
    const d = await (await request.get(`/api/library/${id}`)).json();
    // The fixture has four verses; unnecessary resampling previously left only 5 lyrics.
    expect(d.score.analysisStats.lyrics).toBeGreaterThan(100);
  }
  for (const mode of ["minor", "major"]) {
    await page.getByLabel("원곡의 장·단조").selectOption(mode);
    await expect
      .poll(
        async () => {
          const d = await (await request.get(`/api/library/${id}`)).json();
          return `${d.score.mode}:${d.score.status}`;
        },
        { timeout: 90_000 },
      )
      .toBe(`${mode}:review`);
  }
  await page
    .getByRole("button", { name: "분석 결과 확인 · 선택한 조 생성" })
    .click();
  await expect
    .poll(
      async () => {
        const d = await (await request.get(`/api/library/${id}`)).json();
        return Object.keys(d.score.results).sort().join(",");
      },
      { timeout: 120_000 },
    )
    .toBe("f,g");
  await page.getByRole("button", { name: "G ✓", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "PDF 다운로드", exact: true }),
  ).toBeVisible();
  const href = await page
    .getByRole("link", { name: "PDF 다운로드", exact: true })
    .getAttribute("href");
  expect(
    (await (await request.get(href!)).body()).subarray(0, 5).toString(),
  ).toBe("%PDF-");
  await page.getByLabel("찬송가 검색").fill("67장");
  await expect(page.locator('.hymn-list a[href="/hymns/167"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^67장 .*기본 찬송가/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(name) }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "F ✓", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBeFalsy();
  await page.screenshot({
    path: `test-results/library-${info.project.name}.png`,
    fullPage: true,
  });
});
