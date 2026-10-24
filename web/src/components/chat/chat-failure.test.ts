import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adviserFailureMessage } from '@/lib/ai/adviser-failure';
import ChatFailureNotice from './ChatFailureNotice';
import { chatFailurePresentation, chatHttpFailure, type ChatFailure } from './chat-failure';

const reference = '0b3f4d52-a902-465e-a209-507fc0649c1a';
const structured: ChatFailure = {
  message: 'The AI service was unavailable while this review was running.',
  code: 'provider_unavailable', requestId: reference, retryable: true,
  recordChanges: 'none', historySaved: true, generationCompleted: false,
};
const render = (failure: ChatFailure) => renderToString(createElement(ChatFailureNotice, { failure })).replace(/<!-- -->/g, '');

describe('adviser failure presentation', () => {
  it('shows one legacy reason and one conditional records check rather than concatenated warnings', () => {
    const html = render({ message: 'The adviser could not finish this review. Keep your question and check any completed record changes before retrying.' });
    expect(html).toContain('The adviser could not finish this review.');
    expect(html).toContain('Your question is in the message box');
    expect(html.match(/check your records/g)).toHaveLength(1);
    expect(html).not.toContain('Keep your question');
    expect(html).not.toContain('Check any recorded changes');
  });

  it('does not imply financial changes for a confirmed read-only failure and keeps the support reference', () => {
    const html = render(structured);
    expect(html).toContain('The AI service was unavailable');
    expect(html).toContain(reference);
    expect(html).not.toContain('check your records');
    expect(html).not.toContain('already saved');
  });

  it('retains the server change warning exactly once after a mutation started', () => {
    const details = { code: 'request_timeout' as const, recordChanges: 'possible' as const, generationCompleted: false };
    const html = render({ ...structured, ...details, message: adviserFailureMessage(details) });
    expect(html.match(/record-changing action had already started/g)).toHaveLength(1);
    expect(html.match(/check your records/g)).toHaveLength(1);
    expect(html).not.toContain('were saved');
  });

  it('distinguishes completed generation from an unconfirmed history save without inviting automatic replay', () => {
    const details = { code: 'history_unavailable' as const, recordChanges: 'none' as const, generationCompleted: true };
    const html = render({ ...structured, ...details, historySaved: false, retryable: false, message: adviserFailureMessage(details) });
    expect(html).toContain('Your answer finished');
    expect(html).toContain('Your answer remains above');
    expect(html).not.toContain('incomplete');
    expect(html).not.toContain('<button');
  });

  it('keeps unknown transport failures conditional about record changes', () => {
    const notice = chatFailurePresentation({ message: 'The connection ended before completion was confirmed.' });
    expect(notice.guidance).toContain('If you requested record changes');
    expect(notice.guidance).not.toContain('changes were saved');
  });

  it('keeps a primary provider failure distinct from a secondary history-save failure', () => {
    const html = render({ ...structured, historySaved: false });
    expect(html).toContain('The AI service was unavailable');
    expect(html).toContain('Saving this response to chat history could not be confirmed');
    expect(html).toContain('Keep any answer shown');
  });

  it('preserves only validated structured HTTP failure details', () => {
    const { message, ...details } = structured;
    expect(chatHttpFailure({ error: message, ...details })).toEqual(structured);
    expect(chatHttpFailure({ error: 'Unsafe response', providerResponse: 'private diagnostic' })).toEqual({ message: 'The adviser request could not be started.' });
    expect(chatHttpFailure({ error: 'Stopped', recordChanges: 'invented' })).toEqual({ message: 'The adviser request could not be started.' });
  });
});
