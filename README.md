# BlockGIFs for BetterDiscord

Block specific GIF links and show a small **GIF hidden** label in their place. The rest of the message stays visible. No additional BetterDiscord library is required.

## Install

1. In Discord, open **Settings → BetterDiscord → Plugins → Open Plugins Folder**.
2. Copy **BlockGIFs.plugin.js** into that folder. Only this file is needed.
3. Enable **BlockGIFs**.
4. Open the plugin's settings, paste the GIF link, and click **Add blocked GIF**.

On Windows the usual plugin folder is `%AppData%\BetterDiscord\plugins`.

Use **Remove** to unblock a GIF. Changes save immediately and apply to already visible messages as well as new messages. Disabling the plugin restores everything it hid.

## Link matching

- Supports Tenor and GIPHY share links, their media URLs, and direct GIF or media links, including Discord attachments.
- Prefer the link copied from the message you want to hide. Tenor share links are matched by their numeric GIF ID; GIPHY links by their media ID.
- When Discord provides a matching embed's metadata, the plugin remembers its associated preview and video URLs too. This helps match GIFs Discord renders as MP4 or proxied images.
- Discord attachment expiry and resize parameters are ignored. Unrelated uploads with identical filenames are kept separate.
- A reupload at a different address or a different Tenor/GIPHY listing may need its own blocked entry. The plugin compares links and known media identities, not image contents.
- No external requests or downloads are made by the plugin. Blocking only changes your local message display; Discord may still download the media. It is not a network filter.

The filter covers rendered chat messages, including history when you scroll to it. It does not filter the GIF picker, avatars, or standalone media viewers. Discord interface changes may require selector updates.

## Development

Run `npm ci`, then `npm test` and `npm run check`. Tests exercise the plugin against a simulated Discord DOM and BetterDiscord APIs. A live BetterDiscord client is still needed to verify compatibility with your specific Discord build.

Run `npm run test:browser` to check settings against a background focus handler that tries to redirect typing to the plugin search. This uses an installed Edge or Chrome; set `BGIF_BROWSER` to another Chromium executable if needed. The settings use a native modal dialog to keep background search fields from stealing focus. Done and Escape close the settings and restore normal background interaction.

API references: [BetterDiscord plugin structure](https://docs.betterdiscord.app/plugins/introduction/structure), [settings](https://docs.betterdiscord.app/plugins/tutorials/settings), and [data storage](https://docs.betterdiscord.app/api/Data).
