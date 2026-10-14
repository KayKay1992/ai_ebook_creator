// Unit tests for the narration pipeline's pure parts: markdown → narration
// text, sentence splitting, chunking, hashing, PCM decoding and MP3 encoding.
const {
    markdownToNarration,
    chapterNarration,
    splitSentences,
    splitIntoChunks,
    hashText,
    estimateDurationSec,
} = require('../utils/narrationText');
const { pcmFromInlineData, encodeMp3, silence } = require('../utils/audioEncoding');

describe('markdownToNarration', () => {
    it('strips markdown syntax but keeps the words', () => {
        const text = markdownToNarration('This is **bold**, *italic*, _emphasis_ and ~~gone~~ text with `code`.');
        expect(text).toBe('This is bold, italic, emphasis and gone text with code.');
    });

    it('keeps link text, drops URLs, images and footnote markers', () => {
        const text = markdownToNarration(
            'Read [the guide](https://example.com/guide) now[^1]. ![A chart](https://cdn.example.com/chart.png) See https://example.com or <https://x.y>.'
        );
        expect(text).toBe('Read the guide now. See or.');
        expect(text).not.toMatch(/https?:|example\.com|chart/);
    });

    it('removes fenced code blocks (including an unclosed one) and HTML', () => {
        const md = [
            'Before.',
            '```js',
            'const secret = 1;',
            '```',
            '<div class="note">Inside <b>html</b> &amp; entities</div>',
            '<script>alert(1)</script>',
            'After.',
            '~~~',
            'never closed',
        ].join('\n');
        const text = markdownToNarration(md);
        expect(text).toContain('Before.');
        expect(text).toContain('Inside html & entities');
        expect(text).toContain('After.');
        expect(text).not.toMatch(/secret|alert|never closed|<|>/);
    });

    it('turns headings, list items and table rows into separate sentences', () => {
        const md = '## Key Points\n\n- First point\n- Second point!\n1. Numbered\n\n| Name | Value |\n|---|---|\n| A | 1 |';
        const text = markdownToNarration(md);
        expect(text).toContain('Key Points.');
        expect(text).toContain('First point. Second point! Numbered.');
        expect(text).toContain('Name, Value.');
        expect(text).toContain('A, 1.');
        expect(text).not.toMatch(/[#|]|---/);
    });

    it("doesn't treat snake_case words as italics", () => {
        expect(markdownToNarration('Set max_retry_count to 3.')).toBe('Set max_retry_count to 3.');
    });

    it('returns an empty string when nothing speakable is left', () => {
        expect(markdownToNarration('![only an image](x.png)\n\n---\n\n```\ncode\n```')).toBe('');
        expect(markdownToNarration(undefined)).toBe('');
    });
});

describe('chapterNarration', () => {
    it('reads the title first, then the body', () => {
        const { title, body, text } = chapterNarration({ title: 'The **Beginning**', content: 'It started here.' });
        expect(title).toBe('The Beginning.');
        expect(body).toBe('It started here.');
        expect(text).toBe('The Beginning.\n\nIt started here.');
    });

    it('has no text when the chapter body is empty', () => {
        expect(chapterNarration({ title: 'Empty', content: '   ' }).text).toBe('');
    });
});

describe('splitSentences', () => {
    it("doesn't split after abbreviations, initials, decimals or mid-sentence quotes", () => {
        expect(splitSentences('Dr. Smith met J. K. Rowling. Then "Wow!" she said. It was 3.5 km, e.g. far. Really? Yes.')).toEqual([
            'Dr. Smith met J. K. Rowling.',
            'Then "Wow!" she said.',
            'It was 3.5 km, e.g. far.',
            'Really?',
            'Yes.',
        ]);
    });
});

describe('splitIntoChunks', () => {
    const sentence = (i) => `Sentence number ${i} talks about something interesting for a while.`;
    const paragraph = (from, n) => Array.from({ length: n }, (_, i) => sentence(from + i)).join(' ');
    const words = (s) => s.split(/\s+/).filter(Boolean);

    it('respects the size limit and only ends chunks at sentence boundaries', () => {
        const text = [paragraph(0, 30), paragraph(30, 5), paragraph(35, 40)].join('\n\n');
        const max = 400;
        const chunks = splitIntoChunks(text, max);

        expect(chunks.length).toBeGreaterThan(5);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(max);
            expect(chunk).toMatch(/[.!?]$/); // never cut mid-sentence
            expect(chunk).toMatch(/^Sentence number \d+/); // never starts mid-sentence
        }
        // Nothing lost or reordered.
        expect(words(chunks.join(' '))).toEqual(words(text));
    });

    it('keeps short paragraphs together and splits between paragraphs first', () => {
        const chunks = splitIntoChunks('One short paragraph.\n\nAnother short one.', 1800);
        expect(chunks).toEqual(['One short paragraph.\n\nAnother short one.']);

        const a = paragraph(0, 4);
        const b = paragraph(4, 4);
        expect(splitIntoChunks(`${a}\n\n${b}`, Math.max(a.length, b.length) + 5)).toEqual([a, b]);
    });

    it('splits a single over-long sentence at clauses and words, never inside a word', () => {
        const longSentence = `${Array.from({ length: 60 }, (_, i) => `clause number ${i} goes on`).join(', ')}.`;
        const chunks = splitIntoChunks(longSentence, 200);
        chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(200));
        expect(words(chunks.join(' '))).toEqual(words(longSentence));
    });

    it('returns nothing for empty text', () => {
        expect(splitIntoChunks('')).toEqual([]);
    });
});

describe('hashText / estimates', () => {
    it('changes when the text changes and is stable otherwise', () => {
        expect(hashText('a')).toBe(hashText('a'));
        expect(hashText('a')).not.toBe(hashText('b'));
        expect(hashText('a')).toMatch(/^[a-f0-9]{64}$/);
    });

    it('estimates ~14 characters per second', () => {
        expect(estimateDurationSec(1400)).toBe(100);
    });
});

describe('audio encoding', () => {
    const pcm = (samples) => {
        const buffer = Buffer.alloc(samples * 2);
        for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), i * 2);
        return buffer;
    };
    const wav = (data, sampleRate = 24000) => {
        const header = Buffer.alloc(44);
        header.write('RIFF', 0, 'latin1');
        header.writeUInt32LE(36 + data.length, 4);
        header.write('WAVEfmt ', 8, 'latin1');
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20); // PCM
        header.writeUInt16LE(1, 22); // mono
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36, 'latin1');
        header.writeUInt32LE(data.length, 40);
        return Buffer.concat([header, data]);
    };

    it('decodes both WAV and headerless L16 responses', () => {
        const data = pcm(480);
        const fromWav = pcmFromInlineData({ mimeType: 'audio/wav', data: wav(data, 22050).toString('base64') });
        expect(fromWav.sampleRate).toBe(22050);
        expect(fromWav.samples.length).toBe(480);

        const fromL16 = pcmFromInlineData({ mimeType: 'audio/L16;codec=pcm;rate=24000', data: data.toString('base64') });
        expect(fromL16.sampleRate).toBe(24000);
        expect(Array.from(fromL16.samples)).toEqual(Array.from(fromWav.samples));
    });

    it('rejects unknown formats', () => {
        expect(() => pcmFromInlineData({ mimeType: 'audio/ogg', data: 'AAAA' })).toThrow(/Unsupported/);
    });

    it('encodes PCM segments to an MP3 with the right duration', async () => {
        const { samples } = pcmFromInlineData({ mimeType: 'audio/L16;rate=24000', data: pcm(24000).toString('base64') });
        const { buffer, durationSec } = await encodeMp3([samples, silence(24000, 500)], { sampleRate: 24000 });
        expect(durationSec).toBeCloseTo(1.5, 5);
        // MPEG audio frame sync (11 set bits).
        expect(buffer[0]).toBe(0xff);
        expect(buffer[1] & 0xe0).toBe(0xe0);
        expect(buffer.length).toBeGreaterThan(1000);
    });
});
