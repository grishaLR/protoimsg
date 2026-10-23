import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText, type GenericFacet } from './RichText';

const bytes = (s: string) => new TextEncoder().encode(s).length;

type Feature = GenericFacet['features'][number];

/** A facet spanning `sub` inside `text`, using UTF-8 byte offsets. */
function facet(text: string, sub: string, ...features: Feature[]): GenericFacet {
  const start = bytes(text.slice(0, text.indexOf(sub)));
  return { index: { byteStart: start, byteEnd: start + bytes(sub) }, features };
}

const link = (uri: string): Feature => ({ $type: 'app.bsky.richtext.facet#link', uri });
const bold: Feature = { $type: 'app.protoimsg.chat.message#bold' };
const quote: Feature = { $type: 'app.protoimsg.chat.message#blockquote' };

const render = (text: string, facets?: unknown) =>
  renderToStaticMarkup(<RichText text={text} facets={facets} />);

describe('RichText', () => {
  it('renders plain text when there are no facets', () => {
    expect(render('hello')).toBe('hello');
  });

  it('renders a link facet as a safe external anchor', () => {
    const text = 'see https://example.com now';
    const html = render(text, [facet(text, 'https://example.com', link('https://example.com'))]);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('accepts the protoimsg link facet and protocol-less display text', () => {
    const text = 'go to example.com/a';
    const html = render(text, [
      facet(text, 'example.com/a', {
        $type: 'app.protoimsg.chat.message#link',
        uri: 'https://example.com/a',
      }),
    ]);
    expect(html).toContain('href="https://example.com/a"');
  });

  it('never renders an unsafe URL as a link', () => {
    const text = 'javascript:alert(1)';
    const html = render(text, [facet(text, text, link('javascript:alert(1)'))]);
    expect(html).not.toContain('<a');
  });

  it('refuses links whose text names a different destination (phishing)', () => {
    const text = 'log in at https://chase.com/login';
    const html = render(text, [
      facet(text, 'https://chase.com/login', link('https://evil.example/chase')),
    ]);
    expect(html).not.toContain('<a');
    expect(html).toContain('https://chase.com/login');
  });

  it('nests overlapping facets instead of dropping the link', () => {
    const text = 'https://x.co';
    const html = render(text, [facet(text, text, bold), facet(text, text, link('https://x.co'))]);
    expect(html).toContain('href="https://x.co"');
    expect(html).toContain('<strong>https://x.co</strong>');
  });

  it('keeps a link clickable inside a blockquote', () => {
    const text = 'see https://x.co';
    const html = render(text, [
      facet(text, text, quote),
      facet(text, 'https://x.co', link('https://x.co')),
    ]);
    expect(html).toMatch(/<span class="[^"]*blockquote[^"]*">.*href="https:\/\/x\.co"/);
  });

  it('applies every feature of a multi-feature facet', () => {
    const text = 'https://x.co';
    const html = render(text, [facet(text, text, bold, link('https://x.co'))]);
    expect(html).toContain('href="https://x.co"');
    expect(html).toContain('<strong>');
  });

  it('renders mentions and tags', () => {
    const text = '@alice #proto';
    const html = render(text, [
      facet(text, '@alice', { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:a' }),
      facet(text, '#proto', { $type: 'app.bsky.richtext.facet#tag', tag: 'proto' }),
    ]);
    expect(html).toMatch(/class="[^"]*mention[^"]*">@alice/);
    expect(html).toMatch(/class="[^"]*tag[^"]*">#proto/);
  });

  it('slices by UTF-8 bytes, so text after emoji stays aligned', () => {
    const text = '🎉🎉 bold done';
    const html = render(text, [facet(text, 'bold', bold)]);
    expect(html).toBe('🎉🎉 <span><strong>bold</strong></span> done');
  });

  it('drops the newline next to a block so quotes do not add blank lines', () => {
    const text = 'hi\nquoted\nbye';
    const html = render(text, [facet(text, 'quoted', quote)]);
    expect(html).toMatch(/^hi<span class="[^"]*blockquote[^"]*">quoted<\/span>bye$/);
  });

  // DMs arrive peer-to-peer: facets are untrusted JSON and must never crash
  // the app (the error boundary sits at the root).
  it.each([
    ['null entry', [null]],
    ['missing index', [{ features: [{}] }]],
    ['null index', [{ index: null, features: [bold] }]],
    ['non-iterable', { length: 1 }],
    ['string', 'boom'],
    ['non-integer offsets', [{ index: { byteStart: 0.5, byteEnd: '2' }, features: [bold] }]],
    ['out of range', [{ index: { byteStart: 2, byteEnd: 99 }, features: [bold] }]],
    ['features not objects', [{ index: { byteStart: 0, byteEnd: 2 }, features: [null, 7] }]],
  ])('survives malformed facets: %s', (_name, facets) => {
    expect(() => render('abc', facets)).not.toThrow();
    expect(render('abc', facets)).toBe('abc');
  });

  it('caps the number of facets it processes', () => {
    const text = 'a'.repeat(300);
    const many = Array.from({ length: 300 }, (_, i) => ({
      index: { byteStart: i, byteEnd: i + 1 },
      features: [bold],
    }));
    expect(render(text, many).match(/<strong>/g)).toHaveLength(100);
  });
});
