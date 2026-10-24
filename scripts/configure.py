#!/usr/bin/env python3
"""Collect new, independent local configuration without exposing secrets to chat."""
import getpass
import json
import os
import re
import sys


def main():
    if not sys.stdin.isatty():
        raise ValueError('Run this script yourself in an interactive local terminal.')
    print('Use a separate dotg configuration. This script makes no network requests.')
    mode = input('Telegram intake [polling/webhook] (default polling): ').strip() or 'polling'
    if mode not in ('polling', 'webhook'):
        raise ValueError('Unknown intake mode.')
    bot_id = input('Expected numeric Bot ID: ').strip() if mode == 'polling' else None
    username = input('Expected Bot username without @: ').strip() if mode == 'polling' else None
    if mode == 'polling' and (not re.fullmatch(r'[1-9][0-9]*', bot_id) or not re.fullmatch(r'[A-Za-z0-9_]{5,32}', username)):
        raise ValueError('Explicit expected Bot identity is required.')
    owner = input('Local owner identifier: ').strip()
    chats = [item.strip() for item in input('Allowed private chat IDs (comma-separated): ').split(',')]
    bearer = getpass.getpass('MCP bearer secret (at least 32 characters): ')
    token = getpass.getpass('Telegram Bot token: ')
    webhook = getpass.getpass('Telegram webhook secret (32-256 URL-safe characters): ') if mode == 'webhook' else None
    if not owner or not all(re.fullmatch(r'[1-9][0-9]*', item) for item in chats):
        raise ValueError('Owner and explicit private chat IDs are required.')
    if len(bearer) < 32 or not token.strip() or (mode == 'webhook' and not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', webhook)):
        raise ValueError('Invalid secret format.')
    config = dict(ownerId=owner, allowedChatIds=chats, mcpBearerToken=bearer,
                  telegramBotToken=token, telegramMode=mode)
    if mode == 'polling':
        config.update(expectedBotId=bot_id, expectedBotUsername=username)
    else:
        config['telegramWebhookSecret'] = webhook
    descriptor = os.open('config.local.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(config, output, indent=2)
    print('Saved private config.local.json. No network configuration changed. Polling remains disabled until separately enabled.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyboardInterrupt, EOFError):
        sys.exit('Configuration stopped. Check inputs or whether the file already exists; secrets are not printed.')
