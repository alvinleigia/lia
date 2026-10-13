import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let bundle: string;
test.beforeAll(async () => {
  // Render the real component/primitives; replace only Next's transport and Meta SDK.
  const result = await build({
    stdin: {
      contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WhatsAppOnboarding } from './src/components/whatsapp-onboarding';
      window.signupCalls = [];
      window.FB = { init() {}, login(cb) { window.metaCallback = cb; } };
      createRoot(document.getElementById('root')).render(<WhatsAppOnboarding projectId={42}
        connected={false} settings={location.search.includes('missing') ? null : { appId:'123', configId:'456', apiVersion:'v24.0' }} />);
    `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "signup-test-boundaries",
        setup(plugin) {
          plugin.onResolve({ filter: /onboarding-actions$/ }, () => ({
            path: "actions",
            namespace: "signup-test",
          }));
          plugin.onResolve({ filter: /^next\/script$/ }, () => ({
            path: "script",
            namespace: "signup-test",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "signup-test" },
            ({ path }) => ({
              loader: "js",
              resolveDir: process.cwd(),
              contents:
                path === "script"
                  ? `
          import { useEffect } from 'react';
          export default function Script(props) { useEffect(() => { props.onReady(); }, []); return null; }
        `
                  : `
          export async function beginWhatsAppSignupAction(projectId) { window.signupCalls.push({kind:'begin',projectId}); return {state:'signed-test-state'}; }
          export async function completeWhatsAppSignupAction(input) {
            window.signupCalls.push({kind:'complete',input});
            return window.signupFailure ? {error:'Meta authorization expired. Please reconnect.'} : {success:true,displayPhoneNumber:'+15550000000'};
          }
          export async function checkWhatsAppConnectionAction(projectId) { return {success:true,message:'Connection checked for project '+projectId}; }
        `,
            }),
          );
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route("https://lia-signup.example.test/**", (route) =>
    route.fulfill(
      route.request().url().endsWith("bundle.js")
        ? { contentType: "application/javascript", body: bundle }
        : {
            contentType: "text/html",
            body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
          },
    ),
  );
});

async function start(page: import("@playwright/test").Page) {
  await page.goto("https://lia-signup.example.test/");
  await page.getByLabel("Six-digit WhatsApp security PIN").fill("123456");
  await page
    .getByRole("button", { name: "Connect WhatsApp", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue with Meta" }).click();
}

const finish = `window.dispatchEvent(new MessageEvent('message', {origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH',data:{waba_id:'456',phone_number_id:'789'}})}))`;
const code = `window.metaCallback({authResponse:{code:'test-code'}})`;

test("missing platform configuration shows a clear setup message without a broken launcher", async ({
  page,
}) => {
  await page.goto("https://lia-signup.example.test/?missing");
  await expect(page.getByRole("status")).toContainText(
    "Quick connect is not ready",
  );
  await expect(
    page.getByRole("button", { name: "Connect WhatsApp", exact: true }),
  ).toHaveCount(0);
});

for (const order of ["code-first", "event-first"]) {
  test(`Meta completion works ${order} and duplicate events cannot double-submit`, async ({
    page,
  }) => {
    await start(page);
    await page.evaluate(order === "code-first" ? code : finish);
    expect(
      await page.evaluate(
        "window.signupCalls.filter(x=>x.kind==='complete').length",
      ),
    ).toBe(0);
    await page.evaluate(order === "code-first" ? finish : code);
    await expect(page.getByRole("status")).toContainText("WhatsApp connected");
    await page.evaluate(finish);
    await page.evaluate(code);
    expect(
      await page.evaluate(
        "window.signupCalls.filter(x=>x.kind==='complete').length",
      ),
    ).toBe(1);
    expect(
      await page.evaluate(
        "window.signupCalls.find(x=>x.kind==='complete').input.projectId",
      ),
    ).toBe(42);
    await expect(
      page.getByLabel("Six-digit WhatsApp security PIN"),
    ).toHaveValue("");
    await page.getByRole("button", { name: "Check connection" }).click();
    await expect(page.getByRole("status")).toContainText("project 42");
  });
}

test("forged origins cannot complete signup and cancellation ignores late callbacks", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(code);
  await page.evaluate(
    finish.replace("https://www.facebook.com", "https://evilfacebook.com"),
  );
  expect(
    await page.evaluate(
      "window.signupCalls.filter(x=>x.kind==='complete').length",
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Cancel setup" }).click();
  await page.evaluate(finish);
  expect(
    await page.evaluate(
      "window.signupCalls.filter(x=>x.kind==='complete').length",
    ),
  ).toBe(0);
  await expect(page.getByRole("alert")).toContainText("Setup stopped");
});

test("server failure stays inline, preserves the PIN and allows retry", async ({
  page,
}) => {
  await start(page);
  await page.evaluate("window.signupFailure = true");
  await page.evaluate(finish);
  await page.evaluate(code);
  await expect(page.getByRole("alert")).toContainText("expired");
  await expect(page.getByLabel("Six-digit WhatsApp security PIN")).toHaveValue(
    "123456",
  );
  await expect(
    page.getByRole("button", { name: "Connect WhatsApp", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Check connection" }),
  ).toHaveCount(0);
});

test("invalid PIN does not start authorization", async ({ page }) => {
  await page.goto("https://lia-signup.example.test/");
  await page.getByLabel("Six-digit WhatsApp security PIN").fill("12ab");
  await page
    .getByRole("button", { name: "Connect WhatsApp", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("six-digit");
  expect(await page.evaluate("window.signupCalls.length")).toBe(0);
});
