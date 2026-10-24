# Agent installation and interactive configuration guide

## Current blocker

This version lacks the original plugin source, dependency manifest, deployment entry point, and configuration schema. **Stop at the source completeness check. Do not report installation success.** The steps below define the process to follow after source recovery; they are not a verified deployment procedure.

## Steps the Agent can perform automatically

1. Check read access to this private repository. If access is missing, the repository owner must grant it.
2. Clone or inspect the repository and review existing files and history without overwriting user work.
3. Check that source code, lockfiles, runtime requirements, tests, and a supported deployment entry point are present. Report specific gaps and stop actions that depend on missing components.
4. After source recovery, inspect installation scripts and their side effects before installing local dependencies and running offline checks using the actual dependency manifest. Use commands supported by the recovered source. This guide deliberately provides no speculative npm, Docker, or deployment commands.
5. Generate placeholder-only examples from the actual configuration schema and validate required fields and formats. Do not read existing credential stores to populate configuration.
6. Report the version, completed checks, installation outcome, and remaining blockers without exposing credentials or personal information.

## Steps requiring secure user input or confirmation

1. The user creates or selects their own Bot through the official Telegram BotFather. Do not replace an existing production Bot token.
2. Enter Bot tokens, webhook verification secrets, and pairing information only through the supported deployment platform's secure input controls or a hidden input prompt in a terminal visible to the user on their own computer. Never request these values in chat or put them in repository files, command arguments, recordings, or logs. If the recovered source has no supported secure input mechanism, stop instead of inventing a configuration script.
3. The user chooses the deployment target, costs, domain, access scope, and allowed Telegram users or chats. Present concrete changes and their effects before obtaining explicit authorization to deploy, configure webhooks, or change permissions. Use an independent environment; do not reuse the original plugin identity, database, or credentials.
4. Complete plugin installation, OAuth authorization, and host permission prompts through the host's supported interface. The Agent must not consent on the user's behalf.
5. Obtain consent before sending test messages and use a dedicated test conversation. Do not automatically read real conversations or send messages to unknown recipients.

## Acceptance checks after source recovery

- Verify that the implementation supports the recorded event and four tools, and validate inputs and outputs against their actual schemas.
- Verify webhook origin validation, access controls, message deduplication, sensitive information redaction, and failure behavior.
- After user confirmation, send nonpersonal test text from a dedicated Telegram conversation, verify delivery to Dot, and test reading, replying, and updating. Retain only redacted results, not real conversations.
- Report local checks and production connectivity separately. Previous bidirectional testing does not validate the recovered source version.

## Protect the existing environment

The current repository preparation task does not authorize redeployment, webhook changes, credential creation or replacement, or network and permission changes. This guide does not authorize those actions.

Before every push, inspect all staged files and all history being pushed for tokens, private keys, real conversations, user configuration, pairing information, and runtime data. A `.gitignore` file does not replace review. If secrets are found, stop the push and sanitize the pending content first. Do not automatically rotate production credentials.
