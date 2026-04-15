import { filterText, type FilterResult } from './filter.js';

export function checkMessageContent(text: string): FilterResult {
  return filterText(text);
}
