import { specialistIds, type AdviserMode, type SpecialistId } from './catalog';

export interface SpecialistRoute { ids: SpecialistId[]; reason: string }

/** Identify a routine queue instruction, not a request for financial analysis. */
export function isRoutineCategorizationRequest(message: string, history: { role: string; content: string }[] = []): boolean {
  const continuesLatestUserInstruction = () => {
    const recent = history.slice(-20);
    for (let index = recent.length - 1; index >= 0; index--) {
      // Only the latest user's instruction can anchor a continuation. An
      // assistant's claim or an older categorisation request cannot override
      // a more recent request to book mortgage payments or do other work.
      if (recent[index].role === 'user') return isRoutineCategorizationRequest(recent[index].content, recent.slice(0, index));
    }
    return false;
  };
  const text = message.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!.]+$/, '').trim()
    .replace(/^(?:(?:please|can you|could you|would you|help me(?: to)?|let['’]s|lets)\s+)*/, '');
  if (/\b(?:review|analyse|analyze|advise|recommend|explain|should|whether)\b/.test(text)
    || /\b(?:do not|don't|stop|pause|cancel)\b/.test(text)) return false;
  if (/^(?:(?:keep|continue|resume|start|finish)\s+)?(?:auto[- ]?)?categori[sz](?:e|ing)(?: (?:all|of|my|our|the|remaining|queued|uncategorised|uncategorized|financial|spending|transactions?|records?|data|backlog|everything|again|for|me|now|automatically|please))*$/.test(text)) return true;
  if (/^(?:keep|continue|resume|start|finish)(?: with)? (?:auto[- ]?)?categori[sz]ation(?: (?:all|of|my|our|the|remaining|queued|spending|transactions?|records?|data|backlog|again|now|please))*$/.test(text)) return true;
  if (/^(?:keep|continue|resume|start|finish|carry on)(?: with)? (?:processing|organising|organizing)(?: (?:all|my|our|the|remaining|queued|uncategorised|uncategorized|financial|spending|transactions?|records?|data|backlog|again|now|automatically|please))*$/.test(text)) {
    return /\b(?:spending|transactions?|records?|data|backlog|uncategorised|uncategorized)\b/.test(text) || continuesLatestUserInstruction();
  }
  if (/^(?:process|organise|organize)(?: (?:all|my|our|the|remaining|queued|uncategorised|uncategorized|financial|spending|transactions?|records?|data|backlog|again|now|automatically|please))+$/.test(text)) return true;
  if (/^clear (?:(?:all|my|our|the|remaining|queued) )*(?:categori[sz]ation|spending) (?:backlog|queue)$/.test(text)) return true;
  if (/^clear (?:(?:all|my|our|the|remaining|queued) )*(?:backlog|queue)$/.test(text)) return continuesLatestUserInstruction();
  if (/^(?:do|run|process)(?: (?:the|a|another|next|remaining))* categori[sz]ation batch(?:es)?(?: (?:now|please|again))*$/.test(text)) return true;
  if (/^(?:do|run|process)(?: (?:the|a|another|next|remaining))* batch(?:es)?(?: (?:now|please|again))*$/.test(text)
    || /^(?:keep going|carry on|continue|next batch|again)$/.test(text)) {
    return continuesLatestUserInstruction();
  }
  return false;
}

export function isCategorizationContinuationRequest(message: string, history: { role: string; content: string }[] = []): boolean {
  return isRoutineCategorizationRequest(message, history) && /\b(?:keep|continue|resume|again|next|another|carry on)\b/i.test(message);
}

/** Topic routing selects reviewers only; it never supplies personal facts or authorises a write. */
export function routeSpecialists(message: string, mode: AdviserMode = 'team', history: { role: string; content: string }[] = []): SpecialistRoute {
  if (mode !== 'team' && !specialistIds.includes(mode)) throw new Error('Unknown specialist mode');
  const text = message.trim().toLowerCase();
  if (/^(?:hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening)[!.\s]*$/.test(text)) {
    return { ids: [], reason: 'A conversation greeting does not need a financial review.' };
  }
  if (/^(?:who should lead|which specialist(?: should i (?:use|choose))?|what can (?:you|the specialists) do)[?!.\s]*$/.test(text)) {
    return { ids: [], reason: 'Choosing a specialist does not require a financial review.' };
  }
  if (isRoutineCategorizationRequest(message, history)) {
    return { ids: [], reason: 'Routine categorisation continues through its durable processing job without a financial review.' };
  }
  const control = text.replace(/^(?:(?:please|can you|could you|would you)\s+)*/, '');
  const explicitProcessingControl = /^(?:pause|stop|cancel)\s+(?:(?:the|my|our|current|automatic|auto)\s+)*(?:categori[sz]ation(?: job)?|transaction processing(?: job)?|processing job)(?:\s+(?:now|please))?[?!.]*$/.test(control);
  const contextualProcessingControl = /^(?:pause|stop|cancel)(?: processing)?[?!.]*$/.test(control)
    && isRoutineCategorizationRequest('continue', history);
  if (explicitProcessingControl || contextualProcessingControl) {
    return { ids: [], reason: 'Processing controls do not require a financial review.' };
  }
  // Keep supported record changes on the existing controlled action path.
  // "Save money" remains a spending question, rather than a record write.
  const imperative = /^(?:(?:please|can you|could you|would you|help me to)\s+)*(remember|forget|categori[sz]e|record|book|tag|untag|save|update|correct|set)\b/.exec(text)?.[1];
  if (imperative && (!/^categori[sz]e$/.test(imperative) || !/\b(?:review|analyse|analyze|advise|recommend|explain)\b/.test(text))
    && (/^(?:remember|forget|categori[sz]e|record|book|tag|untag)$/.test(imperative)
    || /\b(?:profile|salary|bonus|paye|pension contribution|identity|memory|budget|goal|balance|date|payment|it|that)\b/.test(text))) {
    return { ids: [], reason: 'The financial adviser handles authorised record changes directly.' };
  }
  if (mode !== 'team') return { ids: [mode], reason: 'The user selected this specialist.' };
  if (/\b(?:all (?:my |our |the )?finances|full financial|financial health check|complete financial|holistic|every area|all areas|review my finances)\b/.test(text)) {
    return { ids: [...specialistIds], reason: 'A broad financial review calls for every specialist.' };
  }
  const followup = /^(?:what about|and |also |yes\b|why\b|how so\b|tell me more\b|go ahead\b)/.test(text);
  const context = followup ? history.filter(item => item.role === 'user').slice(-2).map(item => item.content.slice(0, 1500)).join('\n').toLowerCase() : '';
  const topic = `${text}\n${context}`;
  const matches: [SpecialistId, RegExp][] = [
    ['tax', /\b(?:tax|paye|hmrc|self assessment|salary|bonus|allowance|section 24|capital gains)\b/],
    ['spending', /\b(?:spend(?:ing)?|budget|subscription|cut costs|cut back|reduce costs|save money|cash ?flow|outgoings|expenses)\b/],
    ['wealth', /\b(?:invest(?:ing|ment|ments)?|wealth|portfolio|shares|stocks|isa|diversif(?:y|ication)|fees|asset allocation|build wealth)\b/],
    ['pensions', /\b(?:pension|pensions|retir(?:e|ement)|sipp|annuity|employer match|salary sacrifice)\b/],
    ['property', /\b(?:property|properties|mortgage|btl|buy.to.let|rental|rent|tenant|landlord|refinanc(?:e|ing)|letting)\b/],
    ['debt', /\b(?:debt|debts|credit card|apr|arrears|repay(?:ment)?|overdraft|loan|loans)\b/],
    ['data', /\b(?:missing data|data gaps?|data quality|statements?|imports?|reconcil(?:e|iation)|bank connections?|uncategori[sz]ed|categori[sz]ation)\b/],
  ];
  const ids = matches.filter(([, pattern]) => pattern.test(topic)).map(([id]) => id);
  return ids.length ? { ids, reason: 'Reviewers match the areas raised in the question.' }
    : { ids: ['spending', 'wealth'], reason: 'Start with spending control and long-term financial planning.' };
}
