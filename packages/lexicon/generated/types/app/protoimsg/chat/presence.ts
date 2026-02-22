/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from '@atproto/lexicon';
import { isObj, hasProp } from '../../../../util';
import { lexicons } from '../../../../lexicons';
import { CID } from 'multiformats/cid';

export interface Record {
  /** Current presence status. */
  status: 'online' | 'away' | 'idle' | 'offline' | 'invisible' | (string & {});
  /** Custom away message / status text. */
  awayMessage?: string;
  /** When presence was last updated. */
  updatedAt: string;
  [k: string]: unknown;
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, '$type') &&
    (v.$type === 'app.protoimsg.chat.presence#main' || v.$type === 'app.protoimsg.chat.presence')
  );
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate('app.protoimsg.chat.presence#main', v);
}
