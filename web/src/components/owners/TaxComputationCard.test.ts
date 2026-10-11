import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { SWRConfig } from 'swr';
import TaxComputationCard from './TaxComputationCard';
import { computeOwnerTax, type PropertyLetting } from '@/lib/tax/ownerTaxComputation';

const PROFILE = {
  ownerId: 1, taxYear: '2025-26', employmentIncome: '12570.00', payeTaxPaid: '0.00', selfEmploymentIncome: '0.00',
  savingsInterest: '0.00', dividends: '0.00', otherIncome: '0.00', propertyLossesBroughtForward: '0.00',
  financeCostsBroughtForward: '0.00', notes: null, saved: true, updatedAt: '2026-10-01T10:00:00.000Z',
};

function render(properties: PropertyLetting[], taxYear = '2025-26') {
  const computation = computeOwnerTax({ taxYear, properties, profile: PROFILE });
  const payload = {
    ...computation,
    owner: { id: 1, name: 'Emily Pun' },
    profileSaved: true,
    properties: properties.map((p, i) => ({
      propertyId: i + 1, propertyName: p.name, lettingType: p.lettingType, allocationPct: '50.0000',
      rentARoomShared: Boolean(p.rentARoomShared), grossIncome: String(p.grossIncome),
      totalExpenses: String(p.totalExpenses), mortgageInterest: String(p.mortgageInterest),
    })),
  };
  const fallback = {
    [`/api/owners/1/tax-computation?year=${taxYear}`]: payload,
    [`/api/owners/1/tax-profile?year=${taxYear}`]: { ...PROFILE, taxYear },
  };
  const html = renderToString(
    createElement(SWRConfig, { value: { fallback } }, createElement(TaxComputationCard, { ownerId: 1, year: taxYear })),
  );
  // React's server renderer puts <!-- --> between adjacent text nodes.
  return html.replace(/<!-- -->/g, '');
}

const FRANCIS: PropertyLetting = {
  name: '249 Francis Road', lettingType: 'standard', grossIncome: '10000.00', totalExpenses: '1800.00', mortgageInterest: '2400.00',
};

describe('TaxComputationCard', () => {
  it('renders the Emily-like computation: headline, S.24, bands, payments on account, MTD and the disclaimer', () => {
    const html = render([FRANCIS]);
    expect(html).toContain('Tax computation');
    expect(html).toContain('Estimate only, not tax advice');
    expect(html).toContain('Tax attributable to rental income');
    expect(html).toContain('£1,160.00');
    expect(html).toContain('Actual expenses');
    expect(html).toContain('Used');
    expect(html).toContain('Mortgage interest relief (Section 24)');
    expect(html).toContain('£480.00');
    expect(html).toContain('Payment on account 1');
    expect(html).toContain('2027-07-31');
    expect(html).toContain('£1,740.00');
    expect(html).toContain('Below MTD threshold');
    expect(html).toContain('Step-by-step working');
    // The editable profile form is populated from the saved profile.
    expect(html).toContain('PAYE tax paid');
    expect(html).toContain('12570.00');
    expect(html).toContain('Save and recalculate');
  });

  it('shows the provisional-rates chip and property rates for 2027-28', () => {
    const html = render([FRANCIS], '2027-28');
    expect(html).toContain('Provisional rates');
    expect(html).toContain('22%');
  });

  it('describes a rent-a-room letting', () => {
    const home: PropertyLetting = {
      name: '20 Denbigh Road', lettingType: 'rent_a_room', grossIncome: '5206.40', totalExpenses: '0', mortgageInterest: '0', rentARoomShared: true,
    };
    const html = render([home]);
    expect(html).toContain('Rent-a-room, 20 Denbigh Road');
    expect(html).toContain('£3,750.00');
    expect(html).toContain('alternative method');
  });

  it('shows one pooled rent-a-room line under a single limit, with each home and the reason', () => {
    const homeA: PropertyLetting = { name: '1 Mill Lane', lettingType: 'rent_a_room', grossIncome: '5000', totalExpenses: '0', mortgageInterest: '0', rentARoomShared: false };
    const homeB: PropertyLetting = { name: '2 Mill Lane', lettingType: 'rent_a_room', grossIncome: '5000', totalExpenses: '0', mortgageInterest: '0', rentARoomShared: false };
    const html = render([homeA, homeB]);
    expect(html).toContain('Rent-a-room, 1 Mill Lane: receipts £5,000.00');
    expect(html).toContain('Rent-a-room, 2 Mill Lane: receipts £5,000.00');
    expect(html).toContain('Rent-a-room, all lettings pooled: receipts £10,000.00 against a single £7,500.00 limit');
    expect(html).toContain('Alternative method used: pooled receipts £10,000.00 exceed the single £7,500.00 limit');
    // Every method x treatment option is listed, and exactly one is marked as used.
    expect(html).toContain('Method and rent-a-room treatment');
    expect(html).toContain('Actual expenses, rent-a-room normal method');
    expect(html).toContain('Actual expenses, rent-a-room alternative method');
    expect(html.match(/>Used</g)).toHaveLength(1);
  });

  it('says so when the owner elects out of the exemption', () => {
    const flatShare: PropertyLetting = { name: 'Flat', lettingType: 'standard', grossIncome: '15000', totalExpenses: '2000', mortgageInterest: '0' };
    const home: PropertyLetting = { name: 'Home', lettingType: 'rent_a_room', grossIncome: '5000', totalExpenses: '10000', mortgageInterest: '0', rentARoomShared: false };
    const html = render([flatShare, home]);
    expect(html).toContain('Elected out of the exemption: the normal method gives a £5,000.00 loss that reduces income tax by £1,000.00');
    expect(html).toContain('(a loss)');
  });

  it('shows no rent-a-room text for an owner without rent-a-room lettings', () => {
    const html = render([FRANCIS]);
    expect(html).not.toContain('all lettings pooled');
    expect(html).not.toContain('Method and rent-a-room treatment');
  });
});
