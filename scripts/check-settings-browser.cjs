// Run with npm run test:browser. Uses an installed Edge/Chrome; no Discord access.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {chromium} = require("playwright-core");

const sources = {};
for (const [name, pkg, file] of [
    ["react", "react", "react.production.js"],
    ["react-dom", "react-dom", "react-dom.production.js"],
    ["react-dom/client", "react-dom", "react-dom-client.production.js"],
    ["scheduler", "scheduler", "scheduler.production.js"]
]) sources[name] = fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "cjs", file), "utf8");
sources.plugin = fs.readFileSync(path.join(__dirname, "../BlockGIFs.plugin.js"), "utf8");

async function main() {
    const executablePath = process.env.BGIF_BROWSER || [
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe"
    ].find(file => fs.existsSync(file));
    assert.ok(executablePath, "Set BGIF_BROWSER to a Chrome/Chromium executable.");
    const browser = await chromium.launch({executablePath, headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1000, height: 720}});
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.setContent('<html><body style="background:#121214;color:white;font-family:Arial"><input id="plugin-search" placeholder="Search plugins"><div id="root"></div></body></html>');
        await page.addScriptTag({content: `
            const sources = ${JSON.stringify(sources)};
            const cache = {};
            function require(name) {
                if (cache[name]) return cache[name].exports;
                const module = cache[name] = {exports:{}};
                new Function('module','exports','require',sources[name])(module,module.exports,require);
                return module.exports;
            }
            const React = require('react');
            const h = React.createElement;
            window.saved = [];
            window.redirects = 0;
            window.hostClosed = 0;
            window.BdApi = {React, Data: {load:()=>window.saved,save:(n,k,v)=>window.saved=JSON.parse(JSON.stringify(v))}};
            const search = document.getElementById('plugin-search');
            // Reproduce a settings focus scope which still owns the search while
            // BetterDiscord mounts the plugin modal outside that scope. Capture
            // listeners run before the plugin's React bubbling handlers.
            document.addEventListener('focusin', event => {
                if (event.target !== search) {window.redirects++; search.focus();}
            }, true);
            search.focus();
            const plugin = new (require('plugin'))();
            window.root = require('react-dom/client').createRoot(document.getElementById('root'));
            window.renderSettings = () => window.root.render(h('div', {className:'bd-modal-root bd-addon-modal'},
                plugin.getSettingsPanel(),
                h('div', {className:'bd-modal-footer'}, h('button', {onClick:()=>{window.hostClosed++; window.root.render(null);}}, 'Host Done'))
            ));
            window.renderSettings();
        `});
        const input = page.getByRole("textbox", {name: "GIF link to block"});
        await input.click();
        if (process.argv.includes("--expect-blocked")) {
            await page.keyboard.insertText("probe");
            assert.equal(await page.locator("#plugin-search").inputValue(), "probe");
            assert.equal(await input.inputValue(), "");
            console.log("Reproduced: clicking the GIF field leaves typing in the background plugin search.");
            return;
        }
        assert.equal(await input.evaluate(element => document.activeElement === element), true);
        await input.pressSequentially("https://tenor.com/view/focus-test-12345678");
        await page.getByRole("button", {name: "Add blocked GIF", exact: true}).click();
        await page.waitForFunction(() => window.saved.length === 1);
        assert.equal(await input.inputValue(), "");
        assert.equal(await page.locator("#plugin-search").inputValue(), "");
        assert.ok(await page.evaluate(() => window.redirects > 0));
        if (process.env.BGIF_SCREENSHOT) await page.screenshot({path: process.env.BGIF_SCREENSHOT});
        await page.keyboard.insertText("https://giphy.com/gifs/paste-test-AbCd123");
        await input.press("Enter");
        await page.waitForFunction(() => window.saved.length === 2);
        // Tab stays in the dialog, and background code cannot steal focus.
        await input.press("Tab");
        assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog")), true);
        await page.evaluate(() => document.getElementById("plugin-search").focus());
        assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog")), true);
        await page.getByRole("button", {name: "Done", exact: true}).click();
        await page.waitForFunction(() => window.hostClosed === 1);
        assert.equal(await page.locator("dialog[open]").count(), 0);
        await page.locator("#plugin-search").click();
        await page.keyboard.insertText("usable again");
        assert.equal(await page.locator("#plugin-search").inputValue(), "usable again");
        await page.evaluate(() => {document.getElementById('plugin-search').value=''; window.renderSettings();});
        await page.getByRole("textbox", {name: "GIF link to block"}).click();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => window.hostClosed === 2);
        assert.equal(await page.locator("dialog[open]").count(), 0);
        assert.deepEqual(errors, []);
        console.log("PASS: background focus theft blocked; mouse, typing, pasted text, Enter, Tab, Done, Escape and reopening work.");
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
