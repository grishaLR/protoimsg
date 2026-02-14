import common from '../../public/locales/en/common.json';
import auth from '../../public/locales/en/auth.json';
import chat from '../../public/locales/en/chat.json';
import dm from '../../public/locales/en/dm.json';
import feed from '../../public/locales/en/feed.json';
import rooms from '../../public/locales/en/rooms.json';
import settings from '../../public/locales/en/settings.json';
import atproto from '../../public/locales/en/atproto.json';

export const defaultNS = 'common';

export const resources = {
  en: { common, auth, chat, dm, feed, rooms, settings, atproto },
} as const;
