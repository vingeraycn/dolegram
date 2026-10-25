# Desktop Agent installation

Use this entry point in Codex or ChatGPT Work on the Mac that will run dotg. Computer Use helps with account pages and Telegram; local execution handles configuration, processes and checks. This is an Agent runbook, not a shipped unattended installer.

## One prompt

> Read https://github.com/vingeraycn/dotg/blob/main/docs/desktop-install.md and install dotg on this Mac for my Telegram Bot and existing Dot. First check your available local tools and explain the specific actions you will need from me. Then use local tools and Computer Use to complete the authorized setup, reuse existing resources, protect secrets, preserve rollback, and verify a real Telegram reply and in-place edits. Continue automatically after each required user action; do not hand me configuration steps you can safely complete.

Private repository access is currently required. The Mac must stay available while the service runs. An opt-in [login service](service.md) can manage processes after login; locked or confirmation-only Keychain access can prevent automatic Tunnel recovery. Explain and test these conditions before promising unattended operation. Host features and scheduling vary by account, and no fixed response time is promised.

## Explain participation before starting

Inspect what is already available, then give the owner a short, specific list. Do not ask every owner to repeat all these steps.

| Situation | Agent does | Owner may need to do |
| --- | --- | --- |
| Missing local tools or app access | Identify the exact missing capability and supported setting | Enable required access or open a local task |
| Signed-out account | Open the correct page in the approved local browser | Sign in, complete 2FA or CAPTCHA |
| Ambiguous Bot or account | Find authorized resources and present the unresolved choice | Choose the Bot, account or workspace |
| Credentials unavailable | Prepare a protected destination; explain purpose, scope and lifetime | Enter a secret in secure input or confirm credential access where required |
| macOS authorization prompt | Explain the exact app and item requested | Approve required Screen Recording, Accessibility or the specific Keychain item |
| Handover affects another service | Prepare the scoped handover and rollback | Approve any additional material effect |
| Telegram testing cannot be automated | Prepare the intended chat and harmless test | Send the test message once |

Explain that message bodies and replies go to Telegram and ChatGPT, while the Mac retains a private database. See [data handling](privacy.md). Never ask for tokens in chat. Upfront notice does not replace mandatory action-time confirmation; existing authorization should not be requested again.

## 1. Check capabilities on the intended Mac

Before creating credentials or changing a consumer, verify local file/process access to the intended Mac, access to the repository, a compatible runtime, an approved local browser/app when necessary, and a supported protected credential path. Respect the owner's browser preference and reuse the signed-in local session.

| Task context | Route |
| --- | --- |
| Codex Local / This computer | Use local execution and enabled Computer Use; inspect existing installation paths even if the task has another working directory. |
| Codex Worktree | Locate and preserve the existing production runtime; do not create another in the worktree. |
| ChatGPT Work on This computer | Use available local file, process and Computer Use tools. |
| Cloud Work with approved Local computer access | Verify the connected Mac is online and required local tools actually exist in this task. |
| Cloud-only task or chat without local tools | Explain the missing capability before changes. Have the owner open the appropriate local task or enable supported access; do not substitute a cloud browser. |

Product names alone do not establish permissions. Computer Use and local file access are separate controls; managed policy may restrict either. Do not assume an existing task automatically gains newly enabled cloud/local access.

If Computer Use is absent, explain only the missing setup: enable the Computer Use plugin/server/skill as offered by the client, select necessary app/browser access, and let the owner complete required macOS permissions. Do not request access to unrelated apps.

Confirm the account/workspace supports a private Tunnel connection and MCP Events before creating credentials or stopping a working consumer. A general MCP tool list does not establish Events support. Verify the replacement's actual tools and signed subscription before handover.

## 2. Complete the installation

Follow [INSTALL.md](../INSTALL.md) in order; it is the authoritative configuration and verification procedure. Prefer supported connectors, APIs and local commands for deterministic work. Use Computer Use for account UI and Telegram when supported and authorized, and read the resulting state after actions.

Do not extract browser authentication stores, bypass a denied operation through another tool, use a secret clipboard workaround, or invent Tunnel URLs. A denied Terminal UI operation does not authorize another terminal UI route. Report the specific refusal rather than claiming all local browser access is prohibited.

Proceed through inspection and reuse → protected configuration → intake off → real host tools and signed subscription → one-consumer handover → actual replies and edits. Reuse matching connections, Tunnel profiles and subscriptions. Do not create credentials before confirming the destination and account capabilities.

When owner action is required, pause only dependent work and continue safe independent preparation. Resume automatically after the owner acts, checking live state instead of rebuilding completed resources.

## 3. Leave private checkpoints

Maintain an ignored `installation.local.md` with owner-only permissions. Record the checkout commit, runtime versions, local paths, verified stage and evidence time, next action, resource identifiers needed to resume, current consumer, rollback, redacted blocker and existing authorization. For managed login jobs, also create the strict versioned `installation.local.json` described in [service setup](service.md); it stores paths and lifecycle settings, not credentials or a claim that acceptance passed.

Exclude message bodies, tokens, signing secrets, callback URLs and credential screenshots. Even resource identifiers are private; never commit the note. Recheck stale PIDs, subscriptions and scope before resuming. Keep progress understandable: preparing, connecting, verifying, ready, or waiting for one specific owner action.

## 4. Finish with real evidence

Follow [real acceptance](../INSTALL.md#6-perform-real-acceptance). When authorized Telegram client control is available, send the test yourself. Otherwise request one user test and inspect its actual receipt, callback, read and reply.

Report local checks, host discovery/subscription, short reply, cumulative edits to one message, successful retry deduplication and restart recovery separately. State anything untested, including login/reboot startup. Preserve the prior consumer if host support is missing and report a blocked installation rather than success.

## Official capability references

- [Computer Use setup and app permissions](https://learn.chatgpt.com/docs/computer-use#set-up-computer-use)
- [Local, worktree and cloud environments](https://learn.chatgpt.com/docs/environments/modes)
- [Work across devices and Local computer access](https://learn.chatgpt.com/docs/get-started-with-work#continue-work-across-devices)
- [Local security and managed-device policies](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security#administrator-access-and-managed-device-policies)

These describe product modes, not guaranteed availability for every account. Check actual tools and current official documentation during installation.
