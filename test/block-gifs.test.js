const {test, beforeEach, afterEach} = require("node:test");
const assert = require("node:assert/strict");
const {JSDOM} = require("jsdom");
const React = require("react");
const {act} = React;
const BlockGIFs = require("../BlockGIFs.plugin.js");

let dom, plugin, saved, messages, errors, roots;
const tenor = "https://tenor.com/view/happy-cat-gif-12345678";
const media = "https://media.tenor.com/AbcdefghijklAAAAC/happy-cat.gif";

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><head></head><body><main id='chat'></main></body></html>", {pretendToBeVisual: true});
    global.window = dom.window;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom does not implement native dialogs. Test lifecycle here; the browser
    // regression test exercises real top-layer focus and background inertness.
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new dom.window.Event("close"));
    };
    roots = [];
    for (const key of ["document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"]) {
        global[key] = typeof dom.window[key] === "function" && key !== "MutationObserver" ? dom.window[key].bind(dom.window) : dom.window[key];
    }
    saved = [];
    messages = new Map();
    errors = [];
    global.BdApi = {
        React,
        Data: {
            load: () => structuredClone(saved),
            save: (name, key, value) => { saved = structuredClone(value); }
        },
        DOM: {
            addStyle: (id, css) => {
                const style = document.createElement("style");
                style.id = id;
                style.textContent = css;
                document.head.append(style);
            },
            removeStyle: id => document.getElementById(id)?.remove()
        },
        Webpack: {getStore: () => ({getMessage: (channel, id) => messages.get(`${channel}-${id}`)})},
        Logger: {error: (...args) => errors.push(args)}
    };
    plugin = new BlockGIFs();
});

afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    plugin.stop();
    assert.deepEqual(errors, []);
    dom.window.close();
    delete global.window;
    delete global.IS_REACT_ACT_ENVIRONMENT;
    for (const key of ["document", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "BdApi"]) delete global[key];
});

function block(...urls) { saved = urls.map(url => ({url, aliases: []})); plugin.start(); }
function row(id, html) {
    const element = document.createElement("li");
    element.id = `chat-messages-111-${id}`;
    element.innerHTML = html;
    document.getElementById("chat").append(element);
    return element;
}
function scan() { plugin.scanAll(); plugin.flush(); }
const tick = () => new Promise(resolve => setTimeout(resolve, 50));

function mountPanel(parent) {
    const host = document.createElement("div");
    (parent || document.body).append(host);
    const root = require("react-dom/client").createRoot(host);
    roots.push(root);
    act(() => root.render(plugin.getSettingsPanel()));
    return host;
}

function typeInto(input, value) {
    act(() => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", {bubbles: true}));
    });
}

function submitPanel(panel, value) {
    typeInto(panel.querySelector("input"), value);
    act(() => panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", {cancelable: true, bubbles: true})));
}

test("Tenor and GIPHY identities match different slugs, CDN variants, and trackers", () => {
    block(tenor, "https://giphy.com/gifs/happy-cat-AbCd123");
    assert.ok(plugin.match("https://www.tenor.com/view/another-slug-12345678?utm_source=discord"));
    assert.ok(plugin.match("https://media2.giphy.com/media/v1.hash/AbCd123/200w.mp4"));
    assert.equal(plugin.match("https://giphy.com/gifs/cat-AbCd124"), null);
    assert.equal(plugin.match("https://tenor.com.evil.example/view/cat-12345678"), null);
});

test("Discord signed attachment URLs and proxies match without filename collisions", () => {
    block("https://cdn.discordapp.com/attachments/10/20/cat.gif?ex=old&is=old&hm=old");
    assert.ok(plugin.match("https://media.discordapp.net/attachments/10/20/cat.gif?ex=new&width=200&format=webp"));
    assert.equal(plugin.match("https://cdn.discordapp.com/attachments/10/21/cat.gif"), null);
    plugin.entries.push({url: media, aliases: []});
    plugin.reindex();
    assert.ok(plugin.match("https://images-ext-1.discordapp.net/external/hash/https/media.tenor.com/AbcdefghijklAAAAP/happy-cat.mp4?width=320"));
});

test("exact arbitrary URLs preserve meaningful query parameters", () => {
    block("https://example.com/gif?id=one&utm_source=share");
    assert.ok(plugin.match("https://example.com/gif?utm_source=other&id=one#preview"));
    assert.equal(plugin.match("https://example.com/gif?id=two"), null);
});

test("hides only the blocked item in a mixed attachment grid and restores on stop", () => {
    const message = row(1, `<p>Keep this text</p><div class="attachments_x"><div class="visualMediaItemContainer_a" id="blocked"><a href="${media}"><img src="${media}"></a></div><div class="visualMediaItemContainer_a" id="allowed"><img src="https://example.com/other.gif"></div></div>`);
    block(media);
    scan();
    assert.ok(document.getElementById("blocked").classList.contains("bgif-hidden"));
    assert.equal(document.getElementById("allowed").classList.contains("bgif-hidden"), false);
    assert.equal(message.querySelector("p").textContent, "Keep this text");
    assert.equal(message.querySelectorAll(".bgif-placeholder").length, 1);
    assert.equal(message.querySelector(".bgif-placeholder").textContent, "GIF hidden");
    plugin.stop();
    assert.equal(document.querySelector(".bgif-hidden"), null);
    assert.equal(document.querySelector(".bgif-placeholder"), null);
    assert.equal(document.getElementById("BlockGIFs"), null);
});

test("learns only the matching embed's media, persists it, and hides MP4 rendering", () => {
    messages.set("111-2", {embeds: [
        {url: tenor, video: {url: media.replace("AAAAC", "AAAAP").replace(".gif", ".mp4")}, thumbnail: {proxyURL: media}},
        {url: "https://example.com/unrelated", image: {url: "https://example.com/safe.gif"}}
    ]});
    row(2, `<div class="inlineMediaEmbed_x" id="embed"><video src="${media.replace("AAAAC", "AAAAP").replace(".gif", ".mp4")}" poster="${media}"></video></div><img id="safe" src="https://example.com/safe.gif">`);
    block(tenor);
    scan();
    assert.ok(document.getElementById("embed").classList.contains("bgif-hidden"));
    assert.equal(document.getElementById("safe").classList.contains("bgif-hidden"), false);
    assert.ok(saved[0].aliases.length > 0);
    plugin.stop();
    plugin.start();
    assert.ok(plugin.match(media));
});

test("observer handles new messages, edited URLs, removed media, and rerendered placeholders", async () => {
    block(media);
    const message = row(3, `<a href="${media}"><img src="${media}"></a>`);
    await tick();
    assert.equal(message.querySelectorAll(".bgif-placeholder").length, 1);
    message.querySelector(".bgif-placeholder").remove();
    await tick();
    assert.equal(message.querySelectorAll(".bgif-placeholder").length, 1);
    message.querySelector("a").href = "https://example.com/safe.gif";
    message.querySelector("img").src = "https://example.com/safe.gif";
    await tick();
    assert.equal(message.querySelector(".bgif-placeholder"), null);
    message.querySelector("img").src = media;
    await tick();
    const target = message.querySelector("a");
    target.remove();
    await tick();
    assert.equal(message.querySelector(".bgif-placeholder"), null);
    assert.equal(target.classList.contains("bgif-hidden"), false);
});

test("settings add, duplicate prevention, removal, and persistence work on visible messages", () => {
    row(4, `<a href="${tenor}">a GIF</a>`);
    plugin.start();
    const panel = mountPanel();
    submitPanel(panel, "javascript:alert(1)");
    assert.equal(saved.length, 0);
    submitPanel(panel, tenor);
    scan();
    assert.equal(saved.length, 1);
    assert.equal(document.querySelectorAll(".bgif-placeholder").length, 1);
    submitPanel(panel, "https://tenor.com/view/different-slug-12345678");
    assert.equal(saved.length, 1);
    assert.match(panel.querySelector('[role="status"]').textContent, /already blocked/);
    act(() => panel.querySelector(".bgif-remove").click());
    scan();
    assert.equal(saved.length, 0);
    assert.equal(document.querySelector(".bgif-placeholder"), null);
});

test("works without MessageStore and avoids duplicate placeholders across scans", () => {
    BdApi.Webpack.getStore = () => { throw new Error("unavailable"); };
    row(5, `<article class="embedFull_x"><a href="${tenor}">GIF</a><img src="${media}"></article>`);
    block(tenor);
    scan(); scan(); scan();
    assert.equal(document.querySelectorAll(".bgif-hidden").length, 1);
    assert.equal(document.querySelectorAll(".bgif-placeholder").length, 1);
});

test("disabling cancels pending work and re-enabling keeps the block list", async () => {
    block(media);
    row(6, `<img src="${media}">`);
    plugin.stop();
    await tick();
    assert.equal(document.querySelector(".bgif-placeholder"), null);
    plugin.start();
    await tick();
    assert.equal(document.querySelectorAll(".bgif-placeholder").length, 1);
});

test("invalid persisted data is ignored and settings render URLs as text", () => {
    saved = [{url: "javascript:alert(1)"}, null, {url: "https://example.com/%3Cimg%20src=x%20onerror=alert(1)%3E.gif", aliases: [null, 5]}];
    plugin.start();
    const panel = mountPanel();
    assert.equal(plugin.entries.length, 1);
    assert.deepEqual(plugin.entries[0].aliases, []);
    assert.equal(panel.querySelector("img"), null);
});

test("settings input receives focus and protects native editing from modal handlers", () => {
    plugin.start();
    const modal = document.createElement("div");
    document.body.append(modal);
    const panel = mountPanel(modal);
    const input = panel.querySelector("input");
    const stolen = [];
    for (const event of ["mousedown", "click", "keydown", "paste"]) {
        modal.addEventListener(event, e => { stolen.push(e.type); e.preventDefault(); });
    }
    for (const type of ["mousedown", "click"]) {
        const event = new dom.window.MouseEvent(type, {bubbles: true, cancelable: true});
        assert.equal(input.dispatchEvent(event), true);
    }
    input.focus();
    assert.equal(document.activeElement, input);
    typeInto(input, "https://tenor.com/");
    assert.equal(input.value, "https://tenor.com/");
    const paste = new dom.window.Event("paste", {bubbles: true, cancelable: true});
    assert.equal(input.dispatchEvent(paste), true, "native paste must not be cancelled");
    typeInto(input, tenor);
    const typing = new dom.window.KeyboardEvent("keydown", {key: "v", ctrlKey: true, bubbles: true, cancelable: true});
    assert.equal(input.dispatchEvent(typing), true);
    assert.deepEqual(stolen, []);
    // Tab and Escape still reach the host so keyboard navigation and closing work.
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "Tab", bubbles: true}));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    assert.deepEqual(stolen, ["keydown", "keydown"]);
    act(() => panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", {bubbles: true, cancelable: true})));
    assert.equal(saved[0].url, tenor);
    assert.equal(input.value, "");
    assert.equal(document.activeElement, input);
    assert.match(panel.querySelector('[role="status"]').textContent, /GIF blocked/);
});

test("native settings modal restores its host on close, stop, and forced unmount", () => {
    plugin.start();
    const host = document.createElement("div");
    host.className = "bd-modal-root";
    const footer = document.createElement("div");
    footer.className = "bd-modal-footer";
    const done = document.createElement("button");
    let closed = 0;
    done.addEventListener("click", () => closed++);
    footer.append(done);
    host.append(footer);
    document.body.append(host);
    const panel = mountPanel(host);
    const dialog = panel.querySelector("dialog");
    assert.equal(dialog.open, true);
    assert.equal(plugin.settingsDialogs.size, 1);
    assert.ok(host.classList.contains("bgif-modal-host"));
    act(() => panel.querySelector(".bgif-dialog-footer button").click());
    assert.equal(dialog.open, false);
    assert.equal(closed, 1);
    act(() => roots.pop().unmount());
    assert.equal(host.classList.contains("bgif-modal-host"), false);
    assert.equal(plugin.settingsDialogs.size, 0);
    const second = mountPanel(host);
    act(() => plugin.stop());
    assert.equal(second.querySelector("dialog").open, false);
    assert.equal(closed, 2);
    assert.equal(plugin.settingsDialogs.size, 0);
    act(() => roots.pop().unmount());
    mountPanel(host);
    const open = host.querySelector("dialog");
    act(() => roots.pop().unmount());
    assert.equal(open.open, false);
    assert.equal(host.classList.contains("bgif-modal-host"), false);
    assert.equal(closed, 2, "unmount must not click a stale host button");
});
