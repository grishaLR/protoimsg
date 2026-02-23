import common from '../locales/en/common.json';
import auth from '../locales/en/auth.json';
import chat from '../locales/en/chat.json';
import dm from '../locales/en/dm.json';
import feed from '../locales/en/feed.json';
import rooms from '../locales/en/rooms.json';
import settings from '../locales/en/settings.json';
import atproto from '../locales/en/atproto.json';

export const defaultNS = 'common';

export const resources = {
  en: { common, auth, chat, dm, feed, rooms, settings, atproto },
} as const;
