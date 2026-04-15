import common from '../locales/en/common.json';
import auth from '../locales/en/auth.json';
import dm from '../locales/en/dm.json';
import settings from '../locales/en/settings.json';
import atproto from '../locales/en/atproto.json';
import bot from '../locales/en/bot.json';

export const defaultNS = 'common';

export const resources = {
  en: { common, auth, dm, settings, atproto, bot },
} as const;
