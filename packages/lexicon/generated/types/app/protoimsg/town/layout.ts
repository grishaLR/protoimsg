/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { ValidationResult, BlobRef } from '@atproto/lexicon';
import { isObj, hasProp } from '../../../../util';
import { lexicons } from '../../../../lexicons';
import { CID } from 'multiformats/cid';

export interface Record {
  /** Which space this layout furnishes. Matches the record key. */
  space: 'home' | 'yard' | (string & {});
  /** Objects placed in the space. */
  placements: Placement[];
  updatedAt: string;
  [k: string]: unknown;
}

export function isRecord(v: unknown): v is Record {
  return (
    isObj(v) &&
    hasProp(v, '$type') &&
    (v.$type === 'app.protoimsg.town.layout#main' || v.$type === 'app.protoimsg.town.layout')
  );
}

export function validateRecord(v: unknown): ValidationResult {
  return lexicons.validate('app.protoimsg.town.layout#main', v);
}

/** One placed object. Set exactly one of `item` (an object you own) or `builtin` (a starter object every space has). */
export interface Placement {
  /** An equipment.rpg.item world object in the layout owner's own repo. */
  item?: string;
  /** A starter object id from the app's built-in catalog (e.g. 'couch', 'pine'). */
  builtin?:
    | 'bed'
    | 'nightstand'
    | 'couch'
    | 'armchair'
    | 'table'
    | 'bookshelf'
    | 'plant'
    | 'rug'
    | 'pine'
    | 'bush'
    | 'flowerbed'
    | 'bench'
    | 'lamppost'
    | 'pumpkins'
    | 'garden'
    | 'boulder'
    | 'stone'
    | 'chest'
    | 'barrel'
    | 'wildflowers'
    | (string & {});
  /** Tile column of the object's top-left footprint tile. */
  x: number;
  /** Tile row of the object's top-left footprint tile. */
  y: number;
  /** Facing: 0 down, 1 left, 2 right, 3 up (within what the object supports). */
  rotation: number;
  [k: string]: unknown;
}

export function isPlacement(v: unknown): v is Placement {
  return isObj(v) && hasProp(v, '$type') && v.$type === 'app.protoimsg.town.layout#placement';
}

export function validatePlacement(v: unknown): ValidationResult {
  return lexicons.validate('app.protoimsg.town.layout#placement', v);
}
