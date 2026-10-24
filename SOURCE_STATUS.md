# Source provenance and recovery status

Checked on 2026-10-24.

## Original plugin

The user's original custom Dot bridge plugin has ID `private-identifier-removed`.

Original development conversation: [private-conversation-removed]

Creation card message: `private-identifier-removed`.

The user reports that the original running plugin previously passed bidirectional testing. That service was not changed or retested during this repository work.

## Recovery findings

- Local project and targeted readable memory searches did not locate matching source.
- The supported task reader opened the original conversation but returned only a content reference for the creation card.
- The currently connected Sites account's owned project list did not contain the original project.
- Original plugin file and release-history lookups returned `NOT_FOUND` in the recovery investigation.
- Official [Sites guidance](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites) states that a deleted Site cannot be restored. This does not prove that every independent backup of this particular project is permanently lost.

## Reimplementation

The user authorized a new implementation if original source could not be recovered. The source now in this repository was written anew against official MCP Events and Telegram documentation; it is not the original plugin source and does not preserve its deployment identity or credentials.

DataTalksClub/dots-telegram-assistant was not used as replacement source. No real tokens, user configuration, conversations, pairing information or production runtime data are included. The original plugin and Bot remain separate.

The private repository was created as `vingeraycn/telegram-dot-plugin` and renamed to `vingeraycn/dotg` after explicit user authorization, with normal follow-up commits preserving history. Current tracked content is English; earlier commits remain unchanged as requested.

See ARCHITECTURE.md and INSTALL.md for local checks, supported commands, and integration boundaries. No deployment or live Telegram-to-Dot acceptance test has been performed for this new implementation.
