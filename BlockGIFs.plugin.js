/**
 * @name BlockGIFs
 * @author BlockGIFs
 * @version 1.0.2
 * @description Hide specific GIF links in messages and replace them with a small GIF hidden label.
 */

const NAME = "BlockGIFs";
const ROW = 'li[id^="chat-messages-"], [data-list-item-id^="chat-messages___"]';
const FALLBACK_ROW = '[id^="message-content-"]';
const MEDIA = 'a[href], img[src], video, source[src]';
const CSS = `
.bgif-hidden { display: none !important; }
.bgif-placeholder { display: inline-block; font-size: 12px; line-height: 20px; color: var(--text-muted, #949ba4); font-style: italic; padding: 2px 6px; border-radius: 4px; background: var(--background-secondary, #2b2d31); vertical-align: middle; }
.bgif-settings { pointer-events: auto; -webkit-app-region: no-drag; color: var(--text-normal, #dbdee1); padding: 8px; font-size: 14px; }
.bgif-settings p { line-height: 1.5; margin: 0 0 12px; }
.bgif-form { display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
.bgif-input { pointer-events: auto !important; user-select: text !important; -webkit-user-select: text !important; -webkit-app-region: no-drag; cursor: text; flex: 1; min-width: 180px; color: var(--text-normal, #dbdee1); background: var(--input-background, #1e1f22); border: 1px solid var(--background-modifier-accent, #4e5058); border-radius: 4px; padding: 10px; }
.bgif-button { cursor: pointer; border: 0; border-radius: 4px; padding: 8px 14px; background: var(--brand-500, #5865f2); color: white; font-size: 14px; }
.bgif-button:hover { filter: brightness(1.12); }
.bgif-button:focus-visible, .bgif-input:focus-visible { outline: 2px solid var(--text-link, #00a8fc); outline-offset: 2px; }
.bgif-remove { background: var(--button-danger-background, #da373c); flex-shrink: 0; }
.bgif-entry { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--background-modifier-accent, #4e5058); }
.bgif-url { flex: 1; overflow-wrap: anywhere; min-width: 0; }
.bgif-status { min-height: 20px; font-size: 13px; color: var(--text-muted, #949ba4); }
.bgif-dialog { visibility: visible; position: fixed; inset: 0; margin: auto; width: min(620px, calc(100vw - 48px)); max-height: calc(100vh - 48px); box-sizing: border-box; overflow: auto; padding: 24px; border: 1px solid var(--background-modifier-accent, #383a40); border-radius: 12px; background: var(--background-primary, #111214); color: var(--text-normal, #dbdee1); font-family: inherit; }
.bgif-dialog::backdrop { background: rgba(0, 0, 0, .65); }
.bgif-dialog h2 { margin: 0 0 24px; font-size: 20px; font-weight: 600; }
.bgif-dialog-footer { display: flex; justify-content: flex-end; margin-top: 24px; }
.bgif-modal-host { visibility: hidden !important; }
`;

function parseLink(value) {
    if (typeof value !== "string") return null;
    try {
        const url = new URL(value.trim().replace(/^<|>$/g, ""));
        return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
    } catch { return null; }
}

// Use provider identities, never filenames alone: unrelated uploads can share a name.
function keysFor(value, depth = 0) {
    const url = parseLink(value);
    if (!url || depth > 2) return [];
    let host = url.hostname.toLowerCase().replace(/^www\./, "");
    let path = url.pathname.replace(/\/$/, "");
    const keys = [];
    if (/^images-ext-\d+\.discordapp\.net$/.test(host)) {
        const proxy = path.match(/^\/external\/[^/]+\/(https?)\/(.+)$/);
        if (proxy) keys.push(...keysFor(`${proxy[1]}://${proxy[2]}${url.search}`, depth + 1));
    }
    if (host === "tenor.com") {
        const id = path.match(/^\/(?:[^/]+\/)?view\/[^/]*?(\d+)$/);
        if (id) keys.push(`tenor:${id[1]}`);
    }
    if (/^(?:media\d*|c)\.tenor\.com$/.test(host)) {
        const id = path.split("/")[1];
        if (id) keys.push(`tenor-media:${id.replace(/AAAA[A-Za-z]$/, "")}`);
    }
    if (host === "giphy.com") {
        const id = path.match(/^\/(?:gifs|stickers)\/(?:.*-)?([A-Za-z0-9]+)$/);
        if (id) keys.push(`giphy:${id[1]}`);
    }
    if (/^(?:media\d*|i)\.giphy\.com$/.test(host) || host === "giphy.com") {
        const id = path.match(/^\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]+)(?:\/|$)/);
        if (id) keys.push(`giphy:${id[1]}`);
    }
    if (/^(?:cdn|media)\.discordapp\.(?:com|net)$/.test(host)) {
        host = "cdn.discordapp.com";
        for (const key of ["ex", "is", "hm", "width", "height", "format", "quality"]) url.searchParams.delete(key);
    }
    if (host === "tenor.com" || host.endsWith(".tenor.com") || host === "giphy.com" || host.endsWith(".giphy.com")) url.search = "";
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
    url.searchParams.sort();
    keys.push(`url:${host}${url.port ? `:${url.port}` : ""}${path}${url.search}`);
    return keys;
}

function mediaURLs(object) {
    if (!object || typeof object !== "object") return [];
    return [object.url, object.proxy_url, object.proxyURL].filter(value => typeof value === "string");
}

module.exports = class BlockGIFs {
    constructor() {
        this.entries = [];
        this.index = new Map();
        this.hidden = new Map();
        this.pending = new Set();
        this.settingsDialogs = new Set();
        this.running = false;
        this.frame = null;
    }

    load() {
        const saved = BdApi.Data.load(NAME, "blocked");
        this.entries = (Array.isArray(saved) ? saved : []).filter(entry => parseLink(entry?.url)).map(entry => ({
            url: entry.url,
            aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(key => typeof key === "string").slice(0, 128) : []
        }));
        this.reindex();
    }

    reindex() {
        this.index.clear();
        for (const entry of this.entries) {
            for (const key of [...keysFor(entry.url), ...entry.aliases]) this.index.set(key, entry);
        }
    }

    save() { BdApi.Data.save(NAME, "blocked", this.entries); }

    match(url) {
        for (const key of keysFor(url)) if (this.index.has(key)) return this.index.get(key);
        return null;
    }

    start() {
        if (this.running) return;
        this.load();
        this.running = true;
        try { this.messageStore = BdApi.Webpack.getStore("MessageStore"); }
        catch { this.messageStore = null; }
        BdApi.DOM.addStyle(NAME, CSS);
        this.observer = new MutationObserver(records => {
            for (const record of records) {
                this.queueNode(record.target);
                for (const node of record.addedNodes || []) this.queueNode(node);
            }
            this.schedule();
        });
        this.observe();
        this.scanAll();
    }

    observe() {
        this.observer.observe(document.body, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ["href", "src", "srcset", "poster", "id", "data-list-item-id"]
        });
    }

    stop() {
        this.running = false;
        for (const dialog of this.settingsDialogs) if (dialog.open) dialog.close();
        this.settingsDialogs.clear();
        this.observer?.disconnect();
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.pending.clear();
        for (const [target, placeholder] of this.hidden) this.restore(target, placeholder);
        this.hidden.clear();
        BdApi.DOM.removeStyle(NAME);
        this.messageStore = null;
    }

    onSwitch() { this.scanAll(); }

    queueNode(node) {
        if (node.nodeType !== 1) node = node.parentElement;
        if (!node) return;
        const row = node.closest(ROW) || node.closest(FALLBACK_ROW);
        if (row) this.pending.add(row);
        for (const child of node.querySelectorAll(`${ROW}, ${FALLBACK_ROW}`)) {
            if (child.matches(FALLBACK_ROW) && child.closest(ROW)) continue;
            this.pending.add(child);
        }
    }

    scanAll() {
        if (!this.running) return;
        this.queueNode(document.body);
        this.schedule();
    }

    schedule() {
        if (!this.running || this.frame !== null) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.flush();
        });
    }

    flush() {
        // Ignore our own placeholder mutations; otherwise the observer feeds itself.
        this.observer.disconnect();
        let learned = false;
        try {
            for (const [target, placeholder] of this.hidden) {
                if (!target.isConnected) {
                    this.restore(target, placeholder);
                    this.hidden.delete(target);
                }
            }
            for (const row of this.pending) {
                if (!row.isConnected) continue;
                learned = this.learnAliases(row) || learned;
                this.processRow(row);
            }
        } catch (error) {
            BdApi.Logger?.error(NAME, "Could not update hidden GIFs", error);
        } finally {
            this.pending.clear();
            if (this.running) this.observe();
        }
        if (learned) {
            this.save();
            // A new alias may also identify another already-rendered message.
            this.scanAll();
        }
    }

    learnAliases(row) {
        const identity = `${row.id} ${row.getAttribute("data-list-item-id") || ""}`.match(/chat-messages(?:-|___)(\d+)-(\d+)/);
        if (!identity || !this.messageStore) return false;
        const message = this.messageStore.getMessage(identity[1], identity[2]);
        if (!message) return false;
        const groups = [
            ...(message.embeds || []).map(embed => [
                ...mediaURLs(embed), ...mediaURLs(embed.image),
                ...mediaURLs(embed.thumbnail), ...mediaURLs(embed.video)
            ]),
            ...(message.attachments || []).map(mediaURLs)
        ];
        let changed = false;
        for (const urls of groups) {
            const entry = urls.map(url => this.match(url)).find(Boolean);
            if (!entry) continue;
            for (const key of urls.flatMap(url => keysFor(url))) {
                if (this.index.has(key) || entry.aliases.length >= 128) continue;
                entry.aliases.push(key);
                this.index.set(key, entry);
                changed = true;
            }
        }
        return changed;
    }

    targetFor(element, row) {
        // An embed is one item; attachment grids must be handled one cell at a time.
        for (const selector of [
            '[class*="embedFull_"]', '[class*="inlineMediaEmbed_"]',
            '[class*="visualMediaItemContainer_"]', '[class*="messageAttachment_"]',
            '[class*="imageWrapper_"]'
        ]) {
            const parent = element.closest(selector);
            if (parent && parent !== row && row.contains(parent)) return parent;
        }
        return element.closest("a") || (element.tagName === "SOURCE" ? element.parentElement : element);
    }

    processRow(row) {
        const desired = new Set();
        for (const element of row.querySelectorAll(MEDIA)) {
            const urls = [element.getAttribute("href"), element.getAttribute("src"), element.getAttribute("poster"), element.currentSrc];
            if (!urls.some(url => this.match(url))) continue;
            const target = this.targetFor(element, row);
            if (target && target !== row) desired.add(target);
        }
        // A matching link and image can point into the same embed.
        for (const target of desired) {
            if ([...desired].some(other => other !== target && other.contains(target))) desired.delete(target);
        }
        for (const [target, placeholder] of this.hidden) {
            if (row.contains(target) && !desired.has(target)) {
                this.restore(target, placeholder);
                this.hidden.delete(target);
            }
        }
        for (const target of desired) {
            let placeholder = this.hidden.get(target);
            if (!placeholder) {
                placeholder = document.createElement("span");
                placeholder.className = "bgif-placeholder";
                placeholder.textContent = "GIF hidden";
                placeholder.title = "Hidden by BlockGIFs. Manage blocked links in the plugin settings.";
                this.hidden.set(target, placeholder);
            }
            target.classList.add("bgif-hidden");
            // Discord may remove our sibling when rerendering a message.
            if (target.nextSibling !== placeholder) target.after(placeholder);
        }
    }

    restore(target, placeholder) {
        target.classList.remove("bgif-hidden");
        placeholder.remove();
    }

    getSettingsPanel() {
        if (!this.running) this.load();
        const plugin = this;
        const React = BdApi.React;
        const h = React.createElement;

        function SettingsPanel() {
            const [entries, setEntries] = React.useState(() => plugin.entries.slice());
            const [value, setValue] = React.useState("");
            const [status, setStatus] = React.useState("");
            const inputRef = React.useRef(null);
            const dialogRef = React.useRef(null);
            const titleId = React.useId();
            React.useLayoutEffect(() => {
                const dialog = dialogRef.current;
                const host = dialog.closest(".bd-modal-root");
                const hostDone = host?.querySelector(".bd-modal-footer button");
                const closeHost = () => {
                    // Close only the BetterDiscord modal that owns this panel.
                    // Do not touch the rest of Discord's modal stack.
                    if (hostDone?.isConnected) hostDone.click();
                };
                dialog.addEventListener("close", closeHost);
                // A React event handler cannot stop a document capture listener
                // or focus lock from redirecting focus to the plugin search.
                // Native modality makes background elements inert, so even a
                // programmatic search.focus() cannot steal the input's focus.
                dialog.showModal();
                plugin.settingsDialogs.add(dialog);
                if (hostDone) host.classList.add("bgif-modal-host");
                inputRef.current?.focus({preventScroll: true});
                return () => {
                    dialog.removeEventListener("close", closeHost);
                    if (dialog.open) dialog.close();
                    plugin.settingsDialogs.delete(dialog);
                    host?.classList.remove("bgif-modal-host");
                };
            }, []);
            const stopPropagation = event => event.stopPropagation();
            const submit = event => {
                event.preventDefault();
                event.stopPropagation();
                const url = parseLink(value);
                if (!url) { setStatus("Enter a full http:// or https:// GIF link."); return; }
                if (plugin.match(url.href)) { setStatus("That GIF is already blocked."); return; }
                plugin.entries.push({url: url.href, aliases: []});
                plugin.reindex();
                plugin.save();
                plugin.scanAll();
                setEntries(plugin.entries.slice());
                setValue("");
                setStatus("GIF blocked.");
                inputRef.current?.focus();
            };
            const remove = entry => {
                plugin.entries = plugin.entries.filter(candidate => candidate !== entry);
                plugin.reindex();
                plugin.save();
                plugin.scanAll();
                setEntries(plugin.entries.slice());
                setStatus("GIF unblocked.");
            };
            return h("dialog", {
                ref: dialogRef,
                className: "bgif-settings bgif-dialog",
                "aria-labelledby": titleId,
                // Keep modal mouse/shortcut handlers from consuming editing
                // events. Preserve native focus, text selection, paste and Tab.
                onMouseDown: stopPropagation,
                onClick: stopPropagation,
                onKeyDown: event => {
                    if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
                },
                onPaste: stopPropagation
            },
            // Settings remain styled when opened while the plugin is disabled.
            h("style", null, CSS),
            h("h2", {id: titleId}, "BlockGIFs Settings (v1.0.2)"),
            h("p", null, 'Paste a Tenor or GIPHY share link, or a direct GIF/media link. Matching GIFs in messages will be replaced with "GIF hidden" on your screen. Changes save immediately.'),
            h("form", {className: "bgif-form", onSubmit: submit, noValidate: true},
                h("input", {
                    ref: inputRef,
                    className: "bgif-input",
                    type: "text",
                    inputMode: "url",
                    autoComplete: "off",
                    spellCheck: false,
                    placeholder: "https://tenor.com/view/...",
                    "aria-label": "GIF link to block",
                    value,
                    onChange: event => setValue(event.currentTarget.value)
                }),
                h("button", {className: "bgif-button", type: "submit"}, "Add blocked GIF")
            ),
            h("div", {className: "bgif-status", role: "status"}, status),
            h("div", null, entries.length ? entries.map(entry => h("div", {className: "bgif-entry", key: entry.url},
                h("span", {className: "bgif-url"}, entry.url),
                h("button", {
                    className: "bgif-button bgif-remove",
                    type: "button",
                    "aria-label": `Unblock ${entry.url}`,
                    onClick: () => remove(entry)
                }, "Remove")
            )) : h("p", null, "No blocked GIFs yet.")),
            h("div", {className: "bgif-dialog-footer"},
                h("button", {className: "bgif-button", type: "button", onClick: () => dialogRef.current.close()}, "Done")
            ));
        }
        return h(SettingsPanel);
    }
};
