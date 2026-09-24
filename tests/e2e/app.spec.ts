import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request, context }) => {
  const r = await request.post("/api/session", {
    data: { password: process.env.APP_PASSWORD },
  });
  expect(r.status()).toBe(200);
  await context.addCookies((await request.storageState()).cookies);
});

test("select key, preview, download, share and reload", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/hymns/67?key=ges");
  await expect(
    page.getByRole("heading", { name: "영광의 왕께 다 경배하며" }),
  ).toBeVisible();
  await expect(page.locator(".score-paper img")).toBeVisible();
  await page.getByLabel("연주할 조").selectOption("f");
  await expect(page).toHaveURL(/key=f/);
  const preview = page.getByRole("img", { name: /F장조 악보/ });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(1000);
  const pdfHref = await page
    .getByRole("link", { name: "PDF 다운로드" })
    .getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-disposition"]).toContain("attachment");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const png = await page.request.get(
    (await page
      .getByRole("link", { name: "PNG 다운로드" })
      .getAttribute("href"))!,
  );
  expect(png.headers()["content-type"]).toBe("image/png");
  await page.getByRole("button", { name: "링크 공유" }).click();
  await expect(page.getByText("현재 조의 링크를 복사했어요.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "key=f",
  );
  await page.reload();
  await expect(page.getByLabel("연주할 조")).toHaveValue("f");
  await expect(preview).toBeVisible();
  await page.getByLabel("찬송가 검색").fill("없는곡");
  await expect(
    page.getByText("검색 결과가 없어요.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("찬송가 검색").fill("67");
  await expect(
    page.getByRole("link", { name: /67.*영광의 왕.*기본 찬송가/ }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBeFalsy();
  await page.screenshot({
    path: `test-results/${info.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("reject invalid input and reuse completed renders", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/render", {
        data: { hymnId: "67", key: "f #(system x)" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/render", { data: { hymnId: "../67", key: "f" } })
    ).status(),
  ).toBe(404);
  expect(
    (await request.post("/api/render", { data: "invalid" })).status(),
  ).toBe(400);
  const data = { hymnId: "67", key: "fis" };
  const responses = await Promise.all([
    request.post("/api/render", { data }),
    request.post("/api/render", { data }),
  ]);
  expect(responses.every((response) => response.ok())).toBeTruthy();
  const first = await responses[0].json();
  expect(await responses[1].json()).toEqual(first);
  expect(await (await request.post("/api/render", { data })).json()).toEqual(
    first,
  );
  expect(
    (await request.get(first.pdfUrl.replace("score.pdf", "score.ly"))).status(),
  ).toBe(404);
});

test("render failure can be retried and PDF survives missing PNG", async ({
  page,
}) => {
  let attempt = 0;
  await page.route("**/api/render", async (route) => {
    attempt += 1;
    if (attempt === 1)
      return route.fulfill({
        status: 503,
        json: { error: "테스트 렌더 오류" },
      });
    return route.fulfill({
      json: {
        version: "test",
        pdfUrl: "/test.pdf",
        pages: [],
        warning: "이미지 미리보기를 만들지 못했습니다.",
      },
    });
  });
  await page.goto("/hymns/67");
  await expect(page.locator('.preview-state[role="alert"]')).toContainText(
    "테스트 렌더 오류",
  );
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(
    page.getByRole("link", { name: "PDF 다운로드" }),
  ).toHaveAttribute("href", "/test.pdf?download=1");
  await expect(
    page.getByRole("heading", { name: "PDF 악보가 준비됐어요." }),
  ).toBeVisible();
});
